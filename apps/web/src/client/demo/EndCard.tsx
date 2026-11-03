/**
 * エンドカード（場面 9）：仕組みの図、期間中に作った範囲、Claude Code での進め方、GitHub、クレジット。
 */
import type { Narration } from "./schema.ts";

type Props = { credits: Narration["credits"]; elapsed: number };

const FLOW: { label: string; sub: string; who: "claude" | "program" | "input" | "output" }[] = [
  { label: "記事", sub: "報道・事例集・PDF", who: "input" },
  { label: "Claude が読む", sub: "段階と手法の候補", who: "claude" },
  { label: "照合", sub: "ID の実在・根拠文・型紙", who: "program" },
  { label: "構成グラフ上の判定", sub: "ルール表 × 会社カルテ", who: "program" },
  { label: "経営への影響", sub: "日数・金額・期限（固定データ）", who: "program" },
  { label: "出力", sub: "画面・一枚・依頼文", who: "output" },
];

const BUILT = [
  "記事の読解と手法 ID の対応づけ（記載／推定／不明、根拠文つき）",
  "構成グラフの上を攻撃が進む再生と、判定ルール表（5 状態）",
  "ベンダーへの確認依頼・回答による判定の更新",
  "結論と時間軸（停止日数、売上影響、報告・保険の期限）",
  "対策ボタンによる再判定（効く／効かない）",
  "社長向けの一枚（共有リンク・PDF）",
  "知見なし AI の回答との並置",
  "AI攻撃者（保守ベンダー経路の発見と 4 点検証）",
  "外部確認（DNS と証明書の公開ログだけ）",
  "最初の 5 問からの構成グラフ生成と自動レイアウト",
  "デモモード（このデモ自身）と評価の仕組み",
];

const SESSIONS = [
  ["S0", "基盤・統合・監査の指揮"],
  ["S1", "記事の読解"],
  ["S2", "判定エンジン"],
  ["S3", "描画と動き"],
  ["S4", "経営の層"],
  ["S5", "外部確認"],
  ["S6", "AI攻撃者・比較"],
  ["S7", "確認依頼・回答"],
  ["S8", "デモ・一枚"],
];

export function EndCard({ credits, elapsed }: Props) {
  const step = (t: number) => (elapsed >= t ? " in" : "");
  return (
    <div className="demo-overlay endcard" role="dialog" aria-label="仕組みと締め">
      <div className="end-wrap">
        <header className={`end-head${step(0)}`}>
          <h1>ウチダイ</h1>
          <p>うちの会社は大丈夫か？　に、根拠つきで答えるツール</p>
        </header>

        <section className={`end-flow${step(0.6)}`} aria-label="処理の流れ">
          <svg
            viewBox="0 0 1200 190"
            role="img"
            aria-label="記事 → Claude が読む → 照合 → 構成グラフ上の判定 → 経営への影響 → 出力"
          >
            <title>処理の流れ</title>
            {FLOW.map((f, i) => {
              const x = 20 + i * 195;
              const cls = `end-box ${f.who}`;
              return (
                <g key={f.label} className={cls} style={{ animationDelay: `${0.15 * i}s` }}>
                  <rect x={x} y={40} width={170} height={74} rx={10} />
                  <text className="l" x={x + 85} y={72} textAnchor="middle">
                    {f.label}
                  </text>
                  <text className="s" x={x + 85} y={96} textAnchor="middle">
                    {f.sub}
                  </text>
                  {i < FLOW.length - 1 && (
                    <path className="arrow" d={`M${x + 172} 77 h18 l-6 -6 m6 6 l-6 6`} />
                  )}
                </g>
              );
            })}
            <g className="end-legend">
              <rect x={20} y={140} width={14} height={14} rx={3} className="claude" />
              <text x={42} y={152}>
                Claude：読む・言い換える・書く・探す（構造化出力を zod で検証）
              </text>
              <rect x={560} y={140} width={14} height={14} rx={3} className="program" />
              <text x={582} y={152}>
                プログラム：照合・判定・計算（ルールと固定データ。記事では結論を動かせない）
              </text>
            </g>
          </svg>
        </section>

        <div className="end-cols">
          <section className={`end-col${step(1.4)}`}>
            <h2>期間中に作った範囲</h2>
            <ul>
              {BUILT.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </section>
          <section className={`end-col${step(2.0)}`}>
            <h2>Claude Code での進め方</h2>
            <p className="end-note">
              主セッション（S0）が契約（型・知識スキーマ・デモ用カルテ）を先に固め、領域ごとの並行セッションを
              worktree で分けて進めました。各領域の完了時に監査セッションを回し、評価（`pnpm
              eval`）の点数で読解を改善しています。
            </p>
            <ul className="end-sessions">
              {SESSIONS.map(([id, label]) => (
                <li key={id}>
                  <b className="mono">{id}</b> {label}
                </li>
              ))}
            </ul>
            <p className="end-note">2026-11-02 〜 11-08　Built with Claude: Japan 2026</p>
          </section>
        </div>

        <footer className={`end-foot${step(2.6)}`}>
          <p className="end-url mono">{credits.github}</p>
          <p className="end-credits">
            音声合成：{credits.voice}　／　書体：{credits.fonts}
            {credits.attack ? `　／　${credits.attack}` : ""}
          </p>
          <p className="end-credits">
            デモの会社（デモ精工株式会社）と数値はすべて架空です。事例は IPA
            事例集の公開情報にもとづきます。MIT License.
          </p>
        </footer>
      </div>
    </div>
  );
}
