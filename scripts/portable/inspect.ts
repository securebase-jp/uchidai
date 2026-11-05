/**
 * ZIP の中身の検査。秘密情報や不要なものが入っていないことを、名前と中身の両方から確かめる。
 * ビルドの最後に必ず通す（引っかかったら ZIP を作ったことにしない）。値そのものは出力しない
 */
import type { ZipEntry } from "./zip.ts";
import { readZipEntryData } from "./zip.ts";

/** 入れてはいけない名前（トップのフォルダを除いた相対パス） */
const FORBIDDEN_NAMES: { re: RegExp; why: string }[] = [
  { re: /(^|\/)\.env($|\.)/i, why: ".env 系のファイル" },
  { re: /(^|\/)uchidai\.env$/i, why: "利用者の設定ファイル（uchidai.env）" },
  { re: /(^|\/)\.npmrc$/i, why: ".npmrc（トークンが入りうる）" },
  {
    re: /(^|\/)\.(git|github|claude|data|cache|pnpm-store|vscode|idea)(\/|$)/i,
    why: "開発用・ローカルの状態のフォルダ",
  },
  { re: /(^|\/)\.git(ignore|attributes)?$/i, why: "git のファイル" },
  {
    re: /(^|\/)node_modules\/\.(bin|pnpm|modules\.yaml|pnpm-workspace-state)/i,
    why: "pnpm の作業用のファイル（symlink を含みうる）",
  },
  { re: /\.(pem|key|p12|pfx|crt|cer)$/i, why: "鍵・証明書" },
  { re: /(^|\/)id_(rsa|ed25519|ecdsa)/i, why: "SSH の鍵" },
  {
    re: /(^|\/)app\/(demo|docs|eval\/(cache|results|\.cache)|scripts)(\/|$)/i,
    why: "配布に要らないフォルダ",
  },
  {
    re: /(^|\/)app\/apps\/web\/src\/client(\/|$)/i,
    why: "画面のソース（ビルド済みの dist だけを入れる）",
  },
  { re: /\.test\.tsx?$/i, why: "テスト" },
];

/** 中身に現れてはいけないもの（値の一部だけを使い、出力には種類しか出さない） */
const FORBIDDEN_CONTENT: { re: RegExp; why: string }[] = [
  { re: /sk-ant-[A-Za-z0-9_-]{16,}/, why: "Anthropic の API キーらしき文字列" },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, why: "秘密鍵" },
  { re: /\bghp_[A-Za-z0-9]{30,}/, why: "GitHub のトークンらしき文字列" },
  { re: /\bAKIA[0-9A-Z]{16}\b/, why: "AWS のアクセスキーらしき文字列" },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/, why: "Slack のトークンらしき文字列" },
  {
    re: /^\s*(ANTHROPIC_API_KEY|SMTP_URL)\s*=\s*[^\s#]/m,
    why: "API キーか SMTP の設定に値が入っている行",
  },
];

/** Windows で展開できない名前（予約文字、末尾のドットと空白、予約名）。大文字小文字だけが違う名前の衝突も調べる */
const WINDOWS_BAD_CHAR = /[<>:"|?*]/;
/** 制御文字（0〜31）を含む名前 */
const hasControlChar = (name: string): boolean => [...name].some((ch) => ch.charCodeAt(0) < 32);
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export type Problem = { path: string; why: string };

export type InspectOptions = {
  /** 先頭のフォルダ名（uchidai-0.1.0-win-x64）。全項目がこの下にあること */
  topDir: string;
  /** 環境変数に入っている実際の秘密の値。ZIP の中にあれば失敗にする（値は出力しない） */
  secretValues?: string[];
  /** 中身を調べるときに飛ばす項目（Node の実行ファイルなど） */
  skipContent?: (name: string) => boolean;
  /** Windows の相対パスの最大長（既定 200。展開先の深さの余裕を残す） */
  maxRelativePath?: number;
  /** ZIP 全体のバイト数の上限 */
  maxBytes?: number;
};

export type InspectResult = {
  problems: Problem[];
  files: number;
  longestPath: { path: string; length: number };
  uncompressedBytes: number;
};

function looksBinary(data: Buffer): boolean {
  const n = Math.min(data.length, 8192);
  for (let i = 0; i < n; i++) if (data[i] === 0) return true;
  return false;
}

export function inspectZip(
  zip: Buffer,
  entries: ZipEntry[],
  options: InspectOptions,
): InspectResult {
  const problems: Problem[] = [];
  const prefix = `${options.topDir}/`;
  const maxPath = options.maxRelativePath ?? 200;
  const seenLower = new Map<string, string>();
  const secrets = (options.secretValues ?? []).filter((v) => v.length >= 8);
  let uncompressed = 0;
  let files = 0;
  let longest = { path: "", length: 0 };

  for (const entry of entries) {
    const name = entry.name;
    if (!name.startsWith(prefix)) {
      problems.push({ path: name, why: `先頭のフォルダ ${options.topDir}/ の外にある` });
      continue;
    }
    const rel = name.slice(prefix.length);
    if (rel === "") continue;
    if (entry.isDirectory) continue;
    files++;
    uncompressed += entry.size;
    if (rel.length > longest.length) longest = { path: rel, length: rel.length };
    if (rel.length > maxPath)
      problems.push({
        path: rel,
        why: `相対パスが ${maxPath} 文字を超える（Windows で展開に失敗しうる）`,
      });

    for (const { re, why } of FORBIDDEN_NAMES) if (re.test(rel)) problems.push({ path: rel, why });
    if ((entry.mode & 0o170000) === 0o120000)
      problems.push({ path: rel, why: "シンボリックリンク（Windows で壊れる）" });

    for (const part of rel.split("/")) {
      if (WINDOWS_BAD_CHAR.test(part) || hasControlChar(part))
        problems.push({ path: rel, why: "Windows で使えない文字を含む名前" });
      else if (/[. ]$/.test(part))
        problems.push({ path: rel, why: "末尾がドットか空白の名前（Windows で壊れる）" });
      else if (WINDOWS_RESERVED.test(part)) problems.push({ path: rel, why: "Windows の予約名" });
    }
    const lower = rel.toLowerCase();
    const clash = seenLower.get(lower);
    if (clash)
      problems.push({ path: rel, why: `大文字小文字だけが違う名前と衝突する（${clash}）` });
    else seenLower.set(lower, rel);

    // 配布物にネイティブのバイナリが入ると、OS ごとの差が出る。Node の実行ファイルだけを許す
    if (/\.(node|so|dylib|dll|exe)$/i.test(rel) && !rel.startsWith("runtime/")) {
      problems.push({ path: rel, why: "ネイティブのバイナリ（OS をまたいで使えない）" });
    }

    if (options.skipContent?.(rel)) continue;
    if (entry.size > 8 * 1024 * 1024) continue;
    const data = readZipEntryData(zip, entry);
    if (looksBinary(data)) {
      // フォントや画像など。実際の秘密の値だけは、バイナリでも探す
      for (const value of secrets)
        if (data.includes(value))
          problems.push({ path: rel, why: "環境変数の秘密の値と同じバイト列を含む" });
      continue;
    }
    const text = data.toString("utf8");
    for (const { re, why } of FORBIDDEN_CONTENT)
      if (re.test(text)) problems.push({ path: rel, why });
    for (const value of secrets)
      if (text.includes(value))
        problems.push({ path: rel, why: "環境変数の秘密の値と同じ文字列を含む" });
  }

  if (options.maxBytes !== undefined && zip.length > options.maxBytes) {
    problems.push({
      path: "(ZIP 全体)",
      why: `大きさが上限 ${options.maxBytes} バイトを超える（${zip.length}）`,
    });
  }
  return { problems, files, longestPath: longest, uncompressedBytes: uncompressed };
}
