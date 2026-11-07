/**
 * バックアップ（カルテ＋このブラウザの設定）の書き出しと復元、カルテだけの書き出し。
 * 読み込みは項目ごとに検証し、中身を確認してから復元する（今の内容は置き換わる）。
 * 旧形式（カルテ単体の JSON）も読める。注意書きは i ボタンに収める
 */
import { useRef, useState } from "react";
import {
  applyBackup,
  backupFileName,
  backupText,
  buildBackup,
  type ParsedBackup,
  parseBackupFile,
} from "../lib/backup-file.ts";
import { pendingCount } from "../lib/profile.ts";
import { exportFileName, exportText, MAX_FILE_CHARS } from "../lib/profile-file.ts";
import type { CompanyProfile } from "../lib/types.ts";
import { InfoButton } from "./InfoButton.tsx";

type Props = {
  profile: CompanyProfile | undefined;
  onReplace(p: CompanyProfile): void;
};

type Loaded = { name: string; parsed: Extract<ParsedBackup, { ok: true }> };

export function download(name: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ProfileFile({ profile, onReplace }: Props) {
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState<Loaded>();
  /** 置き換えた後も残す注記（外部確認の結果を持ち込んだ、所有確認はやり直す、など） */
  const [replacedNotes, setReplacedNotes] = useState<string[]>([]);
  const [exported, setExported] = useState<string>();

  async function pick(f: File | undefined) {
    setError(undefined);
    setLoaded(undefined);
    if (!f) return;
    // 読む前に大きさで弾く（2MB 超のファイルを文字列にしない）
    if (f.size > MAX_FILE_CHARS) {
      setError("読み込めませんでした：ファイルが大きすぎます（2MB まで）");
      return;
    }
    const r = parseBackupFile(await f.text());
    if (!r.ok) {
      setError(`読み込めませんでした：${r.reasonJa}`);
      return;
    }
    setLoaded({ name: f.name, parsed: r });
  }

  function restore(l: Loaded) {
    const p = l.parsed;
    if (p.kind === "profile" && p.profile) {
      // カルテ単体は、これまでどおり画面の状態ごと置き換える
      onReplace(p.profile);
      setReplacedNotes(p.notesJa);
      setLoaded(undefined);
      return;
    }
    const r = applyBackup(p);
    if (!r.ok) {
      setError(`復元できませんでした：${r.reasonJa}`);
      setLoaded(undefined);
      return;
    }
    // 画面の状態（事例、ヒント、テーマなど）は保存から読み直すので、再読み込みして反映する
    location.reload();
  }

  const p = loaded?.parsed;

  return (
    <div className="panel">
      <h2>
        バックアップと復元
        <InfoButton title="バックアップについて">
          <p>
            書き出したファイルは自社の弱点の地図です。社外に送らず、保管場所と共有範囲に注意してください。
            会社名、構成要素、対策の有無、製品名と版、業務の数値、個人情報の件数が入ります。
          </p>
          <p>
            会社カルテのほか、担当者名、個人情報の件数区分と「分からない」の記録、選んだ事例、外部確認の記録、画面の設定が入ります。
            確認依頼のメールや、サーバの設定は入りません。
          </p>
          <p>
            復元すると、バックアップに入っている項目はいまの内容から置き換わります。入っていない項目はそのままです。
            カルテだけを書いた古いファイルも読み込めます。
          </p>
        </InfoButton>
      </h2>
      <div className="io" style={{ marginTop: 10 }}>
        <button
          type="button"
          className="btn"
          onClick={() => {
            const now = new Date();
            const name = backupFileName(now);
            download(name, backupText(buildBackup(profile, now)));
            setExported(name);
          }}
        >
          バックアップを書き出す
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          aria-label="バックアップまたはカルテの JSON ファイルを選ぶ"
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button type="button" className="btn" onClick={() => file.current?.click()}>
          復元する
        </button>
        <button
          type="button"
          className="btn"
          disabled={!profile}
          onClick={() => {
            if (!profile) return;
            const name = exportFileName(profile, new Date());
            download(name, exportText(profile));
            setExported(name);
          }}
        >
          カルテだけ書き出す
        </button>
      </div>
      {exported && (
        <p className="saved" style={{ marginTop: 8 }} role="status">
          書き出しました：{exported}
        </p>
      )}
      {error && (
        <p className="err small" style={{ marginTop: 8 }} role="alert">
          {error}
        </p>
      )}
      {replacedNotes.length > 0 && !loaded && (
        <div className="note-warn" style={{ marginTop: 8 }} role="status">
          {replacedNotes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}
      {loaded && p && (
        <section className="import-confirm" aria-label="読み込んだ内容の確認">
          <p>
            <b>{loaded.name}</b> を読みました
            {p.exportedAt ? `（書き出し：${p.exportedAt.slice(0, 16).replace("T", " ")}）` : ""}。
            {p.profile && (
              <>
                {" "}
                カルテは会社名「{p.profile.companyName}」、構成要素 {p.profile.assets.length}{" "}
                件、業務 {p.profile.businesses.length} 件、未確認 {pendingCount(p.profile)} 件
                {p.profile.fictional ? "（架空の会社）" : ""}。
              </>
            )}
          </p>
          <p className="small" style={{ marginTop: 6 }}>
            復元する項目：{p.items.map((i) => i.labelJa).join("、")}
          </p>
          {p.skipped.length > 0 && (
            <p className="err small" style={{ marginTop: 6 }}>
              読めなかった項目（復元しません）：
              {p.skipped.map((s) => `${s.labelJa}（${s.reasonJa}）`).join("、")}
            </p>
          )}
          {p.notesJa.map((n) => (
            <p key={n} className="note-warn small" style={{ marginTop: 6 }}>
              {n}
            </p>
          ))}
          <p className="small" style={{ marginTop: 6 }}>
            いまの内容は置き換わります。
          </p>
          <p className="row" style={{ marginTop: 8 }}>
            <button type="button" className="btn sm primary" onClick={() => restore(loaded)}>
              この内容で復元する
            </button>
            <button type="button" className="btn sm" onClick={() => setLoaded(undefined)}>
              やめる
            </button>
          </p>
        </section>
      )}
    </div>
  );
}
