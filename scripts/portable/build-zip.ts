/**
 * ポータブル ZIP を作る。Node も pnpm も Docker も入っていない PC で、展開してダブルクリックするだけで動く形にする。
 *
 * 使い方（リポジトリのルートで。先に pnpm install と pnpm build を済ませる）：
 *   node --disable-warning=ExperimentalWarning scripts/portable/build-zip.ts --target all --version 0.1.0
 *   node --disable-warning=ExperimentalWarning scripts/portable/build-zip.ts --target win-x64 --version 0.1.0-rc1 --out dist-zip
 *
 * 出力：<out>/uchidai-<版>-<target>.zip と、その SHA-256 を並べた <out>/SHA256SUMS。
 *
 * 中身の組み立て：
 *   - 同梱する Node は nodejs.org の公式の配布物。取得したら、同じ場所の SHASUMS256.txt と、
 *     scripts/portable/node-release.json に固定した値の両方に照らして検証してから使う
 *   - 依存は pnpm install --prod（node-linker=hoisted）で実体として入れ、サーバが実際に import するものだけを残す。
 *     ワークスペースの symlink は ZIP に入れない（Windows で壊れる）ので、実体のソースを指す小さな package.json に置き換える。
 *     これで repoRoot（packages/engine/src/knowledge.ts からの相対）が、製品のコードを変えずにそのまま成り立つ
 *   - 作った ZIP は inspect.ts で検査する（.env 系、鍵、API キーらしき文字列、symlink、Windows で壊れる名前など）
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectZip } from "./inspect.ts";
import { ZipWriter } from "./zip.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");

export const TARGETS = ["win-x64", "macos-arm64", "macos-x64", "linux-x64"] as const;
export type Target = (typeof TARGETS)[number];

type NodeRelease = {
  version: string;
  files: Record<Target, { file: string; sha256: string }>;
};

/** 起動のしかたの案内（README.txt に差し込む） */
const PLATFORM_TEXT: Record<
  Target,
  { launcher: string; template: string; launchHow: string; warning: string; dataNote: string }
> = {
  "win-x64": {
    launcher: "ウチダイを起動.bat",
    template: "start.bat",
    launchHow: "を、ダブルクリックします。",
    warning:
      " 「WindowsによってPCが保護されました」と出たら、「詳細情報」を押し、「実行」を押してください。\n 理由は「導入の手引き.md」に書いています。",
    dataNote: "\n Windows では、%APPDATA%\\uchidai です。",
  },
  "macos-arm64": {
    launcher: "ウチダイを起動.command",
    template: "start.command",
    launchHow:
      "を、右クリック（または control を押しながらクリック）して「開く」を選びます。\n    2 回目からは、ダブルクリックで開けます。",
    warning:
      " 「開発元を検証できないため開けません」と出たら、いったん閉じて、右クリックから「開く」を選び直し、\n 出てくる画面でもう一度「開く」を押してください。理由は「導入の手引き.md」に書いています。",
    dataNote: "\n Mac では、~/Library/Application Support/uchidai です。",
  },
  "macos-x64": {
    launcher: "ウチダイを起動.command",
    template: "start.command",
    launchHow:
      "を、右クリック（または control を押しながらクリック）して「開く」を選びます。\n    2 回目からは、ダブルクリックで開けます。",
    warning:
      " 「開発元を検証できないため開けません」と出たら、いったん閉じて、右クリックから「開く」を選び直し、\n 出てくる画面でもう一度「開く」を押してください。理由は「導入の手引き.md」に書いています。",
    dataNote: "\n Mac では、~/Library/Application Support/uchidai です。",
  },
  "linux-x64": {
    launcher: "start.sh",
    template: "start.sh",
    launchHow: "を、ターミナルで実行します（例：./start.sh）。",
    warning: " 実行できないと言われたら、chmod +x start.sh runtime/node を実行してください。",
    dataNote: "\n Linux では、~/.local/share/uchidai です。",
  },
};

// ---------------------------------------------------------------------------
// 引数
// ---------------------------------------------------------------------------
type Args = { targets: Target[]; version: string; out: string; work: string; mtime: Date };

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const target = get("target") ?? "all";
  const targets = target === "all" ? [...TARGETS] : target.split(",").map((t) => t.trim());
  for (const t of targets) {
    if (!(TARGETS as readonly string[]).includes(t)) {
      throw new Error(`target が正しくありません: ${t}（${TARGETS.join("、")}、または all）`);
    }
  }
  const version = (get("version") ?? "").replace(/^v/, "");
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,40}$/.test(version)) {
    throw new Error("--version を 0.1.0 のような形で指定してください（英数字と . + - だけ）");
  }
  const out = resolve(get("out") ?? join(repoRoot, "dist-zip"));
  const epoch = env.SOURCE_DATE_EPOCH ? Number(env.SOURCE_DATE_EPOCH) * 1000 : Date.now();
  return {
    targets: targets as Target[],
    version,
    out,
    work: join(out, "work"),
    mtime: new Date(epoch),
  };
}

// ---------------------------------------------------------------------------
// 道具
// ---------------------------------------------------------------------------
function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): string {
  const r = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (r.error) throw new Error(`${command} を実行できません: ${r.error.message}`);
  if (r.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} が失敗しました（${r.status}）\n${r.stdout}\n${r.stderr}`,
    );
  }
  return r.stdout;
}

const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

function log(message: string): void {
  console.log(`[build-zip] ${message}`);
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, name.name);
      if (name.isDirectory()) walk(full);
      else if (name.isFile()) out.push(full);
      else
        throw new Error(
          `通常のファイルでもフォルダでもないものがあります（symlink など）: ${full}`,
        );
    }
  };
  walk(dir);
  return out;
}

// ---------------------------------------------------------------------------
// Node.js の取得と検証
// ---------------------------------------------------------------------------
/** SHASUMS256.txt の中から、ファイル名に対応する値を取り出す */
export function shaFromSums(sums: string, file: string): string | undefined {
  for (const line of sums.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (m && m[2] === file) return m[1];
  }
  return undefined;
}

async function download(url: string, to: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`取得に失敗しました（${res.status}）: ${url}`);
  writeFileSync(to, Buffer.from(await res.arrayBuffer()));
}

/** Node の配布物を取得し、公式の SHASUMS256.txt と固定した値の両方で検証して、ファイルの場所を返す */
async function fetchNode(release: NodeRelease, target: Target, cacheDir: string): Promise<string> {
  mkdirSync(cacheDir, { recursive: true });
  const base = `https://nodejs.org/dist/v${release.version}`;
  const sumsPath = join(cacheDir, `SHASUMS256-v${release.version}.txt`);
  if (!existsSync(sumsPath)) await download(`${base}/SHASUMS256.txt`, sumsPath);
  const sums = readFileSync(sumsPath, "utf8");

  const { file, sha256: pinned } = release.files[target];
  const official = shaFromSums(sums, file);
  if (!official) throw new Error(`SHASUMS256.txt に ${file} がありません`);
  if (official !== pinned) {
    throw new Error(
      `${file} の公式の SHA-256 が、固定した値（node-release.json）と違います。公式の配布物が差し替えられたか、版を上げたのに値を更新していません`,
    );
  }

  const archive = join(cacheDir, file);
  if (!existsSync(archive)) await download(`${base}/${file}`, archive);
  const actual = sha256(readFileSync(archive));
  if (actual !== official) {
    rmSync(archive, { force: true });
    throw new Error(
      `${file} の SHA-256 が SHASUMS256.txt と合いません。取得し直してください（壊れた配布物は使いません）`,
    );
  }
  log(`Node ${release.version}（${target}）を検証しました: ${file}`);
  return archive;
}

/** 配布物から実行ファイルと LICENSE だけを取り出す */
function extractNode(archive: string, target: Target, release: NodeRelease, into: string): void {
  mkdirSync(into, { recursive: true });
  const top = release.files[target].file.replace(/\.(zip|tar\.gz|tar\.xz)$/, "");
  const tmp = join(into, ".extract");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  if (target === "win-x64") {
    run("unzip", ["-q", "-o", archive, `${top}/node.exe`, `${top}/LICENSE`, "-d", tmp]);
  } else {
    run("tar", ["-xzf", archive, "-C", tmp, `${top}/bin/node`, `${top}/LICENSE`]);
  }
  const exe = target === "win-x64" ? join(tmp, top, "node.exe") : join(tmp, top, "bin", "node");
  cpSync(exe, join(into, target === "win-x64" ? "node.exe" : "node"));
  cpSync(join(tmp, top, "LICENSE"), join(into, "LICENSE-Node.js.txt"));
  rmSync(tmp, { recursive: true, force: true });
  if (target !== "win-x64") chmodSync(join(into, "node"), 0o755);
}

// ---------------------------------------------------------------------------
// 依存（実際に使うものだけを実体として入れる）
// ---------------------------------------------------------------------------
/** 依存の解決に使うファイル（pnpm のロックファイルと一致させるため、全ワークスペースの package.json を写す） */
function prepareInstallDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const files = [
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "apps/web/package.json",
    "packages/engine/package.json",
    "packages/llm/package.json",
    "packages/recon/package.json",
    "eval/package.json",
    "demo/package.json",
  ];
  for (const f of files) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    cpSync(join(repoRoot, f), join(dir, f));
  }
}

/** ワークスペース側の node_modules に実体のパッケージがあると、ルートからの解決だけでは足りなくなるので止める */
function assertWorkspaceModulesAreLinksOnly(dir: string): void {
  for (const ws of ["apps/web", "packages/engine", "packages/llm", "packages/recon"]) {
    const modules = join(dir, ws, "node_modules");
    if (!existsSync(modules)) continue;
    for (const name of readdirSync(modules)) {
      if (name !== "@uchidai" && name !== ".bin") {
        throw new Error(
          `${ws}/node_modules/${name} に実体があります。hoisted の配置が想定と違うので、build-zip.ts を直してください`,
        );
      }
    }
  }
}

function installProd(dir: string): void {
  prepareInstallDir(dir);
  log("本番用の依存を入れます（pnpm install --prod、hoisted）");
  run(
    "pnpm",
    [
      "install",
      "--prod",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--filter",
      "@uchidai/web...",
      "--node-linker=hoisted",
    ],
    { cwd: dir, env: { ...process.env, CI: "true" } },
  );
  assertWorkspaceModulesAreLinksOnly(dir);
}

/** ソースから、素の（相対でも node: でもない）import の宛先のパッケージ名を集める */
export function bareImports(source: string): Set<string> {
  const names = new Set<string>();
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;
  for (const m of source.matchAll(re)) {
    const spec = m[1];
    if (!spec || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) continue;
    const parts = spec.split("/");
    const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
    if (name && !name.startsWith("@uchidai/")) names.add(name);
  }
  return names;
}

type PackageJson = {
  name?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

/** from から node_modules を上にたどって、パッケージのフォルダ（install からの相対）を探す */
function resolvePackageDir(installRoot: string, fromDir: string, name: string): string | undefined {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (resolve(dir) === resolve(installRoot)) return undefined;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** ルートのパッケージ名から、依存をたどって、実行に要るパッケージのフォルダを集める */
export function collectRuntimePackages(installRoot: string, roots: Iterable<string>): string[] {
  const seen = new Set<string>();
  const queue: { from: string; name: string; optional: boolean }[] = [];
  for (const name of roots) queue.push({ from: installRoot, name, optional: false });
  while (queue.length > 0) {
    const item = queue.pop();
    if (!item) break;
    const dir = resolvePackageDir(installRoot, item.from, item.name);
    if (!dir) {
      if (item.optional) continue;
      throw new Error(
        `パッケージ ${item.name} が見つかりません（${relative(installRoot, item.from) || "."} から）`,
      );
    }
    if (seen.has(dir)) continue;
    seen.add(dir);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as PackageJson;
    for (const dep of Object.keys(pkg.dependencies ?? {}))
      queue.push({ from: dir, name: dep, optional: false });
    for (const dep of Object.keys(pkg.optionalDependencies ?? {}))
      queue.push({ from: dir, name: dep, optional: true });
    // peerDependencies は、入っていれば含める（入っていなくても止めない）
    for (const dep of Object.keys(pkg.peerDependencies ?? {}))
      queue.push({ from: dir, name: dep, optional: true });
  }
  return [...seen].sort();
}

/** 実行に要らないファイル（型定義、ソースマップ、変更履歴、テスト、文書）。ライセンス文は残す。rel はパッケージのフォルダからの相対 */
export function isDroppable(rel: string): boolean {
  if (/(^|\/)(LICENSE|LICENCE|NOTICE|COPYING)[^/]*$/i.test(rel)) return false;
  if (/\.(map|d\.ts|d\.mts|d\.cts)$/.test(rel)) return true;
  if (/(^|\/)(CHANGELOG|HISTORY|README|CONTRIBUTING)[^/]*$/i.test(rel)) return true;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(rel)) return true;
  if (/(^|\/)\.(github|vscode|idea|git|circleci)\//.test(rel)) return true;
  return /(^|\/)(__tests__|tests?|docs)\//.test(rel);
}

// ---------------------------------------------------------------------------
// 組み立て
// ---------------------------------------------------------------------------
type Staged = Map<string, { data: Buffer; mode: number }>;

function addFile(staged: Staged, name: string, data: Buffer | string, mode = 0o644): void {
  staged.set(name, { data: typeof data === "string" ? Buffer.from(data, "utf8") : data, mode });
}

function addTree(
  staged: Staged,
  srcDir: string,
  destDir: string,
  keep: (rel: string) => boolean,
): number {
  let count = 0;
  for (const file of listFiles(srcDir)) {
    const rel = relative(srcDir, file).split(sep).join("/");
    if (!keep(rel)) continue;
    addFile(staged, `${destDir}/${rel}`, readFileSync(file));
    count++;
  }
  return count;
}

const toCrlf = (text: string): string => text.replace(/\r?\n/g, "\r\n");

/** README.txt のひな形に、環境ごとの文面を差し込む */
function renderReadme(template: string, version: string, target: Target): string {
  const t = PLATFORM_TEXT[target];
  return template
    .replaceAll("{{VERSION}}", version)
    .replaceAll("{{LAUNCHER}}", t.launcher)
    .replaceAll("{{LAUNCH_HOW}}", t.launchHow)
    .replaceAll("{{WARNING}}", t.warning)
    .replaceAll("{{DATA_NOTE}}", t.dataNote);
}

function stageApp(staged: Staged, installRoot: string): { moduleDirs: number } {
  const app = "app";
  const isTest = (rel: string) => /\.test\.tsx?$/.test(rel) || rel.endsWith(".tsbuildinfo");

  // 製品のソース（repoRoot の構造をそのまま保つ）
  addFile(
    staged,
    `${app}/package.json`,
    JSON.stringify({ name: "uchidai-portable", private: true, type: "module" }, null, 2),
  );
  addFile(
    staged,
    `${app}/apps/web/package.json`,
    readFileSync(join(repoRoot, "apps/web/package.json")),
  );
  addTree(
    staged,
    join(repoRoot, "apps/web/src/server"),
    `${app}/apps/web/src/server`,
    (r) => !isTest(r),
  );
  addTree(
    staged,
    join(repoRoot, "apps/web/src/shared"),
    `${app}/apps/web/src/shared`,
    (r) => !isTest(r),
  );
  const distDir = join(repoRoot, "apps/web/dist");
  if (!existsSync(join(distDir, "index.html"))) {
    throw new Error("apps/web/dist がありません。先に pnpm build を実行してください");
  }
  addTree(staged, distDir, `${app}/apps/web/dist`, () => true);
  for (const pkg of ["engine", "llm", "recon"]) {
    addFile(
      staged,
      `${app}/packages/${pkg}/package.json`,
      readFileSync(join(repoRoot, `packages/${pkg}/package.json`)),
    );
    addTree(
      staged,
      join(repoRoot, `packages/${pkg}/src`),
      `${app}/packages/${pkg}/src`,
      (r) => !isTest(r),
    );
  }
  addTree(staged, join(repoRoot, "knowledge"), `${app}/knowledge`, () => true);
  addTree(staged, join(repoRoot, "examples"), `${app}/examples`, () => true);
  addTree(staged, join(repoRoot, "eval/recordings"), `${app}/eval/recordings`, () => true);

  // サーバと各パッケージが import する外部パッケージだけを残す
  const roots = new Set<string>();
  for (const [name, { data }] of staged) {
    if (!/\.(ts|mjs|js)$/.test(name) || name.startsWith(`${app}/apps/web/dist/`)) continue;
    for (const dep of bareImports(data.toString("utf8"))) roots.add(dep);
  }
  const dirs = collectRuntimePackages(installRoot, roots);
  for (const dir of dirs) {
    const base = relative(installRoot, dir).split(sep).join("/");
    for (const file of listFiles(dir)) {
      const rel = relative(dir, file).split(sep).join("/");
      // ほかのパッケージの node_modules は、そのパッケージとして別に数えている
      if (rel.startsWith("node_modules/") || rel === "node_modules") continue;
      if (isDroppable(rel)) continue;
      addFile(staged, `${app}/${base}/${rel}`, readFileSync(file));
    }
  }

  // ワークスペースのパッケージ（symlink の代わり）。実体のソースを指す main だけを書いた package.json を置く。
  // main は ../ で外のフォルダを指せる。Node はそのファイルの実体のパスで repoRoot を解くので、knowledge/ などが相対で見つかる
  for (const pkg of ["engine", "llm", "recon"]) {
    addFile(
      staged,
      `${app}/node_modules/@uchidai/${pkg}/package.json`,
      `${JSON.stringify({ name: `@uchidai/${pkg}`, version: "0.0.0", type: "module", main: `../../../packages/${pkg}/src/index.ts` }, null, 2)}\n`,
    );
  }
  return { moduleDirs: dirs.length };
}

export type BuildResult = {
  target: Target;
  zip: string;
  bytes: number;
  sha256: string;
  files: number;
};

async function buildTarget(
  args: Args,
  target: Target,
  release: NodeRelease,
  installRoot: string,
): Promise<BuildResult> {
  const topDir = `uchidai-${args.version}-${target}`;
  const platform = PLATFORM_TEXT[target];
  const work = join(args.work, target);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  const archive = await fetchNode(release, target, join(args.work, "node-cache"));
  const runtimeDir = join(work, "runtime-files");
  extractNode(archive, target, release, runtimeDir);

  const staged: Staged = new Map();
  stageApp(staged, installRoot);

  // ルートのファイル
  const isWin = target === "win-x64";
  addFile(staged, "VERSION", `${args.version}\n`);
  addFile(staged, "LICENSE", readFileSync(join(repoRoot, "LICENSE")));
  addFile(staged, "NOTICE", readFileSync(join(repoRoot, "NOTICE")));
  const guideText = readFileSync(join(repoRoot, "docs/install-zip.md"), "utf8");
  addFile(staged, "導入の手引き.md", isWin ? `\uFEFF${toCrlf(guideText)}` : guideText);
  const envExample = readFileSync(join(here, "templates/uchidai.env.example"), "utf8");
  addFile(staged, "uchidai.env.example", isWin ? toCrlf(envExample) : envExample);
  const readme = renderReadme(
    readFileSync(join(here, "templates/README.txt"), "utf8"),
    args.version,
    target,
  );
  addFile(staged, "はじめにお読みください.txt", isWin ? `\uFEFF${toCrlf(readme)}` : readme);

  // 起動のファイル。.bat は半角の英数字だけの中身にして、CRLF にする
  const launcherText = readFileSync(join(here, "templates", platform.template), "utf8");
  if (isWin && [...launcherText].some((ch) => ch.charCodeAt(0) > 127)) {
    throw new Error(
      "Windows の起動のファイル（.bat）は、半角の英数字だけにしてください（コードページで壊れるため）",
    );
  }
  addFile(
    staged,
    platform.launcher,
    isWin ? toCrlf(launcherText) : launcherText,
    isWin ? 0o644 : 0o755,
  );
  addFile(staged, "runtime/launcher.mjs", readFileSync(join(here, "launcher.mjs")));
  addFile(staged, "runtime/launcher-lib.mjs", readFileSync(join(here, "launcher-lib.mjs")));
  addFile(
    staged,
    "runtime/LICENSE-Node.js.txt",
    readFileSync(join(runtimeDir, "LICENSE-Node.js.txt")),
  );
  const exeName = isWin ? "node.exe" : "node";
  addFile(staged, `runtime/${exeName}`, readFileSync(join(runtimeDir, exeName)), 0o755);

  // ZIP に書く（名前順、先頭のフォルダの下に）
  mkdirSync(args.out, { recursive: true });
  const zipPath = join(args.out, `${topDir}.zip`);
  const writer = new ZipWriter(zipPath, { mtime: args.mtime });
  for (const name of [...staged.keys()].sort()) {
    const item = staged.get(name);
    if (item) writer.addFile(`${topDir}/${name}`, item.data, item.mode);
  }
  const entries = writer.finish();

  // 検査（失敗したら ZIP を残さない）
  const zip = readFileSync(zipPath);
  const secretValues = ["ANTHROPIC_API_KEY", "SMTP_URL"]
    .map((k) => process.env[k] ?? "")
    .filter(Boolean);
  const result = inspectZip(zip, entries, {
    topDir,
    secretValues,
    skipContent: (rel) => rel === `runtime/${exeName}`,
    maxBytes: 120 * 1024 * 1024,
  });
  if (result.problems.length > 0) {
    rmSync(zipPath, { force: true });
    const lines = result.problems.map((p) => `  ${p.path}: ${p.why}`).join("\n");
    throw new Error(`ZIP の検査に失敗しました（${target}）\n${lines}`);
  }
  log(
    `${topDir}.zip: ${(zip.length / 1024 / 1024).toFixed(1)} MB、${result.files} ファイル、最長の相対パス ${result.longestPath.length} 文字（${result.longestPath.path}）`,
  );

  // 展開に使うツールがあれば、独立した実装でも整合性を確かめる
  const unzipTest = spawnSync("unzip", ["-tq", zipPath], { encoding: "utf8" });
  if (unzipTest.error === undefined && unzipTest.status !== 0) {
    rmSync(zipPath, { force: true });
    throw new Error(`unzip -t が失敗しました: ${unzipTest.stdout}${unzipTest.stderr}`);
  }
  rmSync(work, { recursive: true, force: true });
  return { target, zip: zipPath, bytes: zip.length, sha256: sha256(zip), files: result.files };
}

export async function main(argv: string[]): Promise<BuildResult[]> {
  const args = parseArgs(argv);
  const release = JSON.parse(readFileSync(join(here, "node-release.json"), "utf8")) as NodeRelease;
  mkdirSync(args.work, { recursive: true });

  const installRoot = join(args.work, "install");
  installProd(installRoot);

  const results: BuildResult[] = [];
  for (const target of args.targets)
    results.push(await buildTarget(args, target, release, installRoot));

  const sums = results.map((r) => `${r.sha256}  ${relative(args.out, r.zip)}`).join("\n");
  writeFileSync(join(args.out, "SHA256SUMS"), `${sums}\n`);
  log(`SHA256SUMS を書きました（${results.length} 件）`);
  rmSync(installRoot, { recursive: true, force: true });
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
