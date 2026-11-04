/**
 * 出典（#/sources）：このツールが参考にした資料の一覧。
 * 会社カルテ・事例・判定は読まない軽い画面（共有リンクの一枚と同じく、AppProvider の外で描く）。
 * 一覧の元は knowledge/sources.yaml。ATT&CK の版は version.json から API が差し込む
 */
import { useEffect, useState } from "react";
import { InfoButton } from "../components/InfoButton.tsx";
import { TopBar } from "../components/TopBar.tsx";
import type { Settings } from "../hooks/useSettings.ts";
import { api, type SourcesView } from "../lib/api.ts";

type Item = SourcesView["categories"][number]["sources"][number];

function SourceItem({ s }: { s: Item }) {
  return (
    <li className="src-item">
      <div className="src-name">
        <a className="src-link" href={s.url} target="_blank" rel="noreferrer">
          {s.nameJa}
        </a>
        {s.version && <span className="src-version">v{s.version}</span>}
        {s.noticeJa && (
          <InfoButton title="引用の表記と注意">
            <p>{s.noticeJa}</p>
          </InfoButton>
        )}
      </div>
      <dl className="src-meta">
        <div className="src-meta-row">
          <dt>発行元</dt>
          <dd>{s.publisherJa}</dd>
        </div>
        {s.licenseJa && (
          <div className="src-meta-row">
            <dt>利用条件</dt>
            <dd>{s.licenseJa}</dd>
          </div>
        )}
        {s.checkedAt && (
          <div className="src-meta-row">
            <dt>確認日</dt>
            <dd>{s.checkedAt}</dd>
          </div>
        )}
      </dl>
      <p className="src-use">
        <span className="src-use-label">このツールでの使い道</span>
        {s.usedForJa}
      </p>
    </li>
  );
}

export function Sources({ settings }: { settings: Settings }) {
  const [view, setView] = useState<SourcesView>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    api
      .sources()
      .then((v) => alive && setView(v))
      .catch(
        () =>
          alive && setError("出典の一覧を読み込めませんでした。時間をおいて開き直してください。"),
      );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="wrap">
      <TopBar route="sources" theme={settings.theme} onToggleTheme={settings.toggleTheme} />
      <main className="sources">
        <h1 className="src-title">
          出典
          <InfoButton title="この一覧について">
            <p>
              ここに並べた資料は、このツールの判定ルール、期限、費用の目安、画面の書体などの元になっています。名前を押すと、提供元のページが新しいタブで開きます。
            </p>
            <p>
              確認日は、開発者が資料の内容や利用条件を確かめた日です。その後に資料が更新されていることがあるので、大事な判断の前には、提供元のページで最新の内容をご確認ください。
            </p>
            <p>
              一覧の元データはリポジトリの knowledge/sources.yaml で、この画面と README、NOTICE
              はそこと食い違わないように保っています。
            </p>
          </InfoButton>
        </h1>
        <p className="muted">このツールが参考にした資料です</p>
        {error && <p className="err">{error}</p>}
        {!view && !error && <p className="muted">読み込み中…</p>}
        {view?.categories.map((c) => (
          <section key={c.id} className="src-cat" aria-labelledby={`src-${c.id}`}>
            <h2 id={`src-${c.id}`}>{c.titleJa}</h2>
            {c.noteJa && <p className="muted src-cat-note">{c.noteJa}</p>}
            <ul className="src-list">
              {c.sources.map((s) => (
                <SourceItem key={s.id} s={s} />
              ))}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
