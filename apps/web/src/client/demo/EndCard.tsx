/**
 * エンドカード（場面 10・11）。2 段に動く図と締め。
 *   roles（場面 10 前半・12 秒）：左に Claude の使い道、中央に検証、右に「判定と計算は、プログラム」
 *   trace（場面 10 後半・12 秒）：Claude Code の跡（並行セッション、役割分担、採点の推移、監査で見つけた穴、コミット数）
 *   close（場面 11・8 秒）：大きな一行、継続して使うこと、GitHub、クレジット。最後の 2 秒はロゴと一行だけ
 * 時刻は、その段が出てからの経過秒数。数字は demo/endcard-facts.json から読んで数え上げる（直前に数え直す）。
 */
import { Logo } from "../components/Logo.tsx";
import { endcardFacts } from "./data.ts";
import { countUp } from "./layers.tsx";
import type { Narration } from "./schema.ts";

export type EndPhase = "roles" | "trace" | "close";
type Props = { phase: EndPhase; credits: Narration["credits"]; elapsed: number };

const on = (elapsed: number, t: number) => (elapsed >= t ? " in" : "");

const CLAUDE_USES: { verb: string; what: string; at: number }[] = [
  { verb: "読む", what: "記事を段階に分ける（根拠文つき）", at: 0.6 },
  { verb: "探す", what: "AI 攻撃者が、別の入口を下見する", at: 1.4 },
  { verb: "書く", what: "ベンダーへのメール、社長の一枚", at: 2.2 },
  { verb: "比べる", what: "知見のない AI の答えと並べる", at: 3.0 },
];
const CHECKS: { text: string; at: number; drop?: boolean }[] = [
  { text: "手法 ID の照合（存在しない ID は捨てる）", at: 4.4 },
  { text: "根拠文（記事に書いてあるか）", at: 5.0 },
  { text: "判定ルール（型紙にある手法だけ）", at: 5.6 },
  { text: "数値の検証（金額・日数をプログラムで確かめる）", at: 6.2 },
  { text: "通らなければ、捨てる", at: 6.8, drop: true },
];

function Roles({ elapsed }: { elapsed: number }) {
  return (
    <div className="end-wrap roles">
      <header className="end-title in">
        <h1>Claude は、読む・探す・書く・比べる。決めるのは、プログラム。</h1>
      </header>
      <div className="end-diagram">
        <section className={`end-col claude${on(elapsed, 0.3)}`} aria-label="Claude の使い道">
          <h2>Claude の使い道</h2>
          <ul>
            {CLAUDE_USES.map((u) => (
              <li key={u.verb} className={on(elapsed, u.at).trim()}>
                <b>{u.verb}</b>
                <span>{u.what}</span>
              </li>
            ))}
          </ul>
        </section>
        <div className={`end-arrow${on(elapsed, 3.7)}`} aria-hidden="true">
          →
        </div>
        <section className={`end-col verify${on(elapsed, 4.0)}`} aria-label="検証">
          <h2>検証</h2>
          <ul>
            {CHECKS.map((c) => (
              <li key={c.text} className={`${c.drop ? "drop " : ""}${on(elapsed, c.at).trim()}`}>
                <i aria-hidden="true">{c.drop ? "✕" : "✓"}</i>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        </section>
        <div className={`end-arrow${on(elapsed, 7.6)}`} aria-hidden="true">
          →
        </div>
        <section className={`end-col program${on(elapsed, 8.0)}`} aria-label="判定と計算">
          <h2>判定と計算は、プログラム</h2>
          <p>ルールと固定データで、決定的に。</p>
          <ul>
            <li className={on(elapsed, 8.6).trim()}>
              <span>突破か、止まるか</span>
            </li>
            <li className={on(elapsed, 9.0).trim()}>
              <span>止まる日数と、金額</span>
            </li>
            <li className={on(elapsed, 9.4).trim()}>
              <span>報告の期限</span>
            </li>
          </ul>
          <p className="end-note">記事や AI の出力では、結論を動かせません。</p>
        </section>
      </div>
    </div>
  );
}

function Trace({ elapsed }: { elapsed: number }) {
  const f = endcardFacts;
  const approx = (v: boolean) => (v ? "約 " : "");
  const bars = f.scoring.series;
  return (
    <div className="end-wrap trace">
      <header className="end-title in">
        <h1>Claude Code で、1 週間で。</h1>
      </header>
      <div className="trace-grid">
        <section className={`trace-card${on(elapsed, 0.4)}`}>
          <h2>並行セッション</h2>
          <p className="trace-num">
            {approx(f.sessions.approx)}
            <b>{countUp(f.sessions.total, elapsed, 0.6, 1.6)}</b>
          </p>
          <p className="trace-sub">領域ごとの worktree（{f.sessions.areasJa.length} 領域）</p>
          <ul className="trace-chips">
            {f.sessions.areasJa.map((a, i) => (
              <li key={a} className={on(elapsed, 1.0 + i * 0.12).trim()}>
                {a}
              </li>
            ))}
          </ul>
        </section>
        <section className={`trace-card${on(elapsed, 2.2)}`}>
          <h2>役割分担</h2>
          <dl className="trace-roles">
            {f.roles.map((r, i) => (
              <div key={r.model} className={on(elapsed, 2.6 + i * 0.5).trim()}>
                <dt>{r.model}</dt>
                <dd>{r.roleJa}</dd>
              </div>
            ))}
          </dl>
          <p className="trace-sub">計画と実装を分け、領域ごとに並行して回す</p>
        </section>
        <section className={`trace-card${on(elapsed, 3.8)}`}>
          <h2>コミット</h2>
          <p className="trace-num">
            <b>{countUp(f.commits, elapsed, 4.0, 1.6)}</b>
          </p>
          <p className="trace-sub">2026-11-02 〜 11-08</p>
        </section>
        <section className={`trace-card wide${on(elapsed, 5.6)}`}>
          <h2>採点の推移（知見あり）</h2>
          <ul className="trace-bars">
            {bars.map((b, i) => {
              const at = 6.0 + i * 0.9;
              return (
                <li key={b.labelJa} className={on(elapsed, at).trim()}>
                  <span className="lab">{b.labelJa}</span>
                  <span className="bar">
                    <i style={{ width: elapsed >= at ? `${b.withKnowledge}%` : "0%" }} />
                  </span>
                  <b>{countUp(b.withKnowledge, elapsed, at, 0.9)}%</b>
                </li>
              );
            })}
          </ul>
          <p className="trace-sub">
            採点の記録 {countUp(f.scoring.records, elapsed, 6.0, 1.6)} 回（正解データ{" "}
            {f.scoring.cases} 件）
          </p>
        </section>
        <section className={`trace-card${on(elapsed, 8.2)}`}>
          <h2>監査セッションが見つけた穴</h2>
          <p className="trace-num">
            {approx(f.audits.approx)}
            <b>{countUp(f.audits.found, elapsed, 8.4, 1.4)}</b>
            <span>件</span>
          </p>
          <ul className="trace-chips">
            {f.audits.examplesJa.map((e, i) => (
              <li key={e} className={on(elapsed, 9.2 + i * 0.3).trim()}>
                {e}
              </li>
            ))}
          </ul>
          <p className="trace-sub">見つけて、直して、テストで固定</p>
        </section>
      </div>
    </div>
  );
}

function Close({ credits, elapsed }: { credits: Narration["credits"]; elapsed: number }) {
  // 最後の 2 秒は、ロゴと一行だけ
  const last = elapsed >= 6;
  return (
    <div className={`end-wrap close${last ? " last" : ""}`}>
      <h1 className={`close-line${on(elapsed, 0.3)}`}>壁の外側にいる、ひとりへ。</h1>
      <div className={`close-small${on(elapsed, 1.4)}`}>
        <p>ニュースが出るたびに、リンクを貼る。カルテは、半年ごとに見直す。</p>
        <p>ローカルで動き、会社のデータは外に預けない。OSS。</p>
      </div>
      <p className={`end-url mono${on(elapsed, 2.6)}`}>{credits.github}</p>
      <div className={`end-credits-block${on(elapsed, 3.4)}`}>
        <p className="end-credits">
          音声合成：{credits.voice}　／　書体：{credits.fonts}
          {credits.attack ? `　／　${credits.attack}` : ""}
        </p>
        <p className="end-credits">
          デモの会社（デモ精工株式会社）と数値はすべて架空です。事例は IPA
          事例集の公開情報にもとづきます。MIT License.
        </p>
      </div>
      <div className={`close-logo${on(elapsed, 0.3)}`}>
        <Logo />
        <p>うちの会社は大丈夫か？　に、根拠つきで答える</p>
      </div>
    </div>
  );
}

export function EndCard({ phase, credits, elapsed }: Props) {
  return (
    <div className={`demo-overlay endcard ${phase}`} role="dialog" aria-label="仕組みと締め">
      {phase === "roles" && <Roles elapsed={elapsed} />}
      {phase === "trace" && <Trace elapsed={elapsed} />}
      {phase === "close" && <Close credits={credits} elapsed={elapsed} />}
    </div>
  );
}
