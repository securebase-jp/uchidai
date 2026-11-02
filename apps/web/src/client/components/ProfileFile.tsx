/**
 * カルテの JSON の書き出しと読み込み。書き出しは自社の弱点の地図なので取り扱いに注意する旨を明記。
 * 読み込みは zod で検証し、失敗なら日本語の理由、成功なら置き換えの確認（この画面の中で）
 */
import { useRef, useState } from "react";
import { pendingCount } from "../lib/profile.ts";
import {
  exportFileName,
  exportText,
  MAX_FILE_CHARS,
  parseProfileFile,
} from "../lib/profile-file.ts";
import type { CompanyProfile } from "../lib/types.ts";

type Props = {
  profile: CompanyProfile | undefined;
  onReplace(p: CompanyProfile): void;
};

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
  const [loaded, setLoaded] = useState<{
    name: string;
    profile: CompanyProfile;
    notesJa: string[];
  }>();
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
    const r = parseProfileFile(await f.text());
    if (!r.ok) {
      setError(`読み込めませんでした：${r.reasonJa}`);
      return;
    }
    setLoaded({ name: f.name, profile: r.profile, notesJa: r.notesJa });
  }

  return (
    <div className="panel">
      <h2>カルテの書き出しと読み込み（JSON ファイル）</h2>
      <p className="note-warn">
        書き出したファイルは自社の弱点の地図です。社外に送らず、保管場所と共有範囲に注意してください。
        ファイルには会社名、構成要素、対策の有無、製品名と版、業務の数値、個人情報の件数が入ります。
      </p>
      <div className="io" style={{ marginTop: 10 }}>
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
          カルテを書き出す
        </button>
        {exported && <span className="saved">書き出しました：{exported}</span>}
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          aria-label="カルテの JSON ファイルを選ぶ"
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button type="button" className="btn" onClick={() => file.current?.click()}>
          カルテを読み込む
        </button>
      </div>
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
      {loaded && (
        <section className="import-confirm" aria-label="読み込んだカルテの確認">
          <p>
            <b>{loaded.name}</b> を読みました：会社名「{loaded.profile.companyName}」、構成要素{" "}
            {loaded.profile.assets.length} 件、業務 {loaded.profile.businesses.length} 件、未確認{" "}
            {pendingCount(loaded.profile)} 件{loaded.profile.fictional ? "（架空の会社）" : ""}。
            {profile ? "いまのカルテを置き換えますか。" : "このカルテを使いますか。"}
          </p>
          {loaded.notesJa.map((n) => (
            <p key={n} className="note-warn small" style={{ marginTop: 6 }}>
              {n}
            </p>
          ))}
          <p className="row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn sm primary"
              onClick={() => {
                onReplace(loaded.profile);
                setReplacedNotes(loaded.notesJa);
                setLoaded(undefined);
              }}
            >
              {profile ? "置き換える" : "使う"}
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
