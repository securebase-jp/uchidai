/**
 * ウチダイの宣言（場面 3 の頭）：暗転から、タイトルと 3 行（誰の／どんな課題を／どう解決）を順に出す。
 * 文言は脚本（docs/demo-script-v2.md）のとおり。時刻は overlay が出てからの経過秒数
 */
const T_TITLE = 0.7;
const LINES: { at: number; labelJa: string; textJa: string }[] = [
  { at: 1.6, labelJa: "誰の", textJa: "ひとり情シスの" },
  { at: 4.0, labelJa: "どんな課題を", textJa: "社長の「大丈夫？」に答えられない" },
  {
    at: 6.4,
    labelJa: "どう解決",
    textJa: "同じ攻撃が自社で起きたらどうなるかを再生し、根拠つきで答える",
  },
];

export function DeclarationOverlay({ elapsed }: { elapsed: number }) {
  const on = (t: number) => (elapsed >= t ? " in" : "");
  return (
    <div className="demo-overlay declaration" role="dialog" aria-label="ウチダイとは（宣言）">
      <div className="decl-wrap">
        <h1 className={`decl-title${on(T_TITLE)}`}>
          <span>ウチダイ</span>
          <b aria-hidden="true">＝</b>
          <span>うちの会社は大丈夫か？</span>
        </h1>
        <ol className="decl-lines">
          {LINES.map((l) => (
            <li key={l.labelJa} className={on(l.at).trim()}>
              <em>{l.labelJa}</em>
              <span>{l.textJa}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
