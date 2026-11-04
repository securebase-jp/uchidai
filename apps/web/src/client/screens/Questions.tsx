/**
 * 最初の5問：1画面1問、すべて選択式、文字入力なし。
 * 回答が確定するたびに構成図のノードが順に現れて図が組み上がる（約5秒）
 */
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import "../components/flow.css";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { Diagram } from "../components/Diagram.tsx";
import { InfoButton } from "../components/InfoButton.tsx";
import { useApp } from "../hooks/useApp.tsx";
import { api } from "../lib/api.ts";
import { layoutGraph } from "../lib/layout.ts";
import { optionIcon } from "../lib/question-icons.ts";
import { optionsForIndustry } from "../lib/question-options.ts";
import { reconHints } from "../lib/reconHints.ts";
import { hintLabel } from "../lib/reconView.ts";
import type { Graph, ProfileAnswers, Question } from "../lib/types.ts";

type Partial5 = {
  industry?: ProfileAnswers["industry"];
  site?: ProfileAnswers["site"];
  hosting?: Partial<ProfileAnswers["hosting"]>;
  remoteAccess?: ProfileAnswers["remoteAccess"];
  backup?: ProfileAnswers["backup"];
};

function complete(a: Partial5): ProfileAnswers {
  return {
    industry: a.industry ?? "other",
    site: a.site ?? "office_only",
    hosting: {
      mail: a.hosting?.mail ?? "unknown",
      files: a.hosting?.files ?? "unknown",
      core: a.hosting?.core ?? "unknown",
      web: a.hosting?.web ?? "unknown",
    },
    remoteAccess: a.remoteAccess ?? [],
    backup: a.backup ?? "unknown",
  };
}

/** 選択肢の左のアイコン（無ければ何も出さない）。文字が主で、アイコンは目印 */
function OptIcon({ icon: Icon }: { icon: LucideIcon | undefined }) {
  if (!Icon) return null;
  return <Icon className="opt-icon" size={20} strokeWidth={2} aria-hidden="true" />;
}

const EMPTY_GRAPH: Graph = { nodes: [], edges: [] };

export function Questions({ reduced }: { reduced: boolean }) {
  const app = useApp();
  const questions = app.knowledge?.questions ?? [];
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Partial5>({});
  const [graph, setGraph] = useState<Graph>(EMPTY_GRAPH);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [appearing, setAppearing] = useState<Set<string>>(new Set());
  // 外部確認（#/domain）の初期値。該当の質問で初期選択し「外部から推定」と出す（担当者は確かめるだけ）
  const [hints] = useState(() => reconHints.load()?.answersHints);
  const hinted = (key: "hosting.mail" | "hosting.web" | "remoteAccess") =>
    hints?.inferred.includes(key) ? hints : undefined;
  const [remote, setRemote] = useState<ProfileAnswers["remoteAccess"]>(
    () => hinted("remoteAccess")?.answers.remoteAccess ?? [],
  );
  const [hosting, setHosting] = useState<Partial<ProfileAnswers["hosting"]>>(() => {
    const mail = hinted("hosting.mail")?.answers.hosting.mail;
    const web = hinted("hosting.web")?.answers.hosting.web;
    return { ...(mail ? { mail } : {}), ...(web ? { web } : {}) };
  });
  const [error, setError] = useState<string>();
  const [confirmReset, setConfirmReset] = useState(false);
  const timers = useRef<number[]>([]);
  const layout = useMemo(() => layoutGraph(graph), [graph]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  async function commit(next: Partial5, final: boolean) {
    setAnswers(next);
    try {
      const { profile, graph: g } = await api.fromAnswers(complete(next), "うちの会社");
      const before = new Set(graph.nodes.map((n) => n.id));
      const fresh = g.nodes.filter((n) => !before.has(n.id)).map((n) => n.id);
      setGraph(g);
      setAppearing(new Set(fresh));
      if (!reduced && fresh.length > 0) {
        setHidden(new Set(fresh));
        const per = Math.min(400, Math.max(120, 4500 / fresh.length));
        fresh.forEach((id, i) => {
          timers.current.push(
            window.setTimeout(
              () =>
                setHidden((h) => {
                  const n = new Set(h);
                  n.delete(id);
                  return n;
                }),
              per * (i + 1),
            ),
          );
        });
      } else {
        setHidden(new Set());
      }
      if (final) {
        app.setProfile(profile, "answers");
        const wait = reduced ? 0 : Math.min(5200, 600 + fresh.length * 300);
        timers.current.push(window.setTimeout(() => (location.hash = "/staff"), wait));
      } else {
        setStep((s) => s + 1);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信に失敗しました");
    }
  }

  // 最初の5問のリセット：回答と、そこから作ったこのブラウザのカルテを消して、何も選んでいない状態に戻す
  const dirty = step > 0 || Object.keys(answers).length > 0 || app.ownProfile !== undefined;
  function reset() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setStep(0);
    setAnswers({});
    setGraph(EMPTY_GRAPH);
    setHidden(new Set());
    setAppearing(new Set());
    setRemote([]);
    setHosting({});
    setError(undefined);
    app.clearProfile();
    setConfirmReset(false);
  }

  const q: Question | undefined = questions[step];
  const isLast = step === questions.length - 1;

  return (
    <div className="quiz">
      <div className="qcard">
        <div className="progress" aria-hidden="true">
          {questions.map((x, i) => (
            <i key={x.id} className={i <= step ? "bar on" : "bar"} />
          ))}
        </div>
        {q ? (
          <>
            <div className="step">
              {step + 1} / {questions.length}
              <button
                type="button"
                className="btn ghost sm reset-btn"
                disabled={!dirty}
                onClick={() => setConfirmReset(true)}
              >
                リセットする
              </button>
              <InfoButton title="最初の5問について">
                <p>
                  文字入力はありません。2
                  分以内で終わります。回答はこのブラウザにだけ保存されます。会社名は、あとでカルテの画面で登録できます。
                </p>
                <p>
                  回答するたびに、右側（狭い画面では下側）に御社の構成図が組み上がります。「外部から推定」と付いた項目は、ドメインの外部確認（DNS・証明書の公開ログ）から推定した初期値で、合っているかを確かめるだけで進めます。
                </p>
              </InfoButton>
            </div>
            <h2>{q.textJa}</h2>
            {q.hintJa && <p className="hint">{q.hintJa}</p>}
            {hints &&
              ((q.id === "hosting" && (hinted("hosting.mail") || hinted("hosting.web"))) ||
                (q.id === "remoteAccess" && hinted("remoteAccess"))) && (
                <p className="hint">
                  <span className="chip">外部から推定</span>{" "}
                  と付いた項目は、ドメインの外部確認（DNS・証明書の公開ログ）から推定した初期値です。合っているかを確かめるだけで進めます。
                </p>
              )}
            {q.id === "hosting" ? (
              <>
                {q.rows.map((r) => (
                  <div className="hosting-row" key={r.key}>
                    <span className="k">
                      {r.labelJa}
                      {(r.key === "mail" || r.key === "web") &&
                        hinted(`hosting.${r.key}`) &&
                        hosting[r.key] === hints?.answers.hosting[r.key] && (
                          <span
                            className="chip"
                            style={{ marginLeft: 6 }}
                            title={hints?.reasonsJa[`hosting.${r.key}`]}
                          >
                            外部から推定：{hintLabel(`hosting.${r.key}`, hosting[r.key] ?? "")}
                          </span>
                        )}
                    </span>
                    <div className="opts-inline">
                      {q.options.map((o) => (
                        <button
                          type="button"
                          key={o.value}
                          className="btn sm"
                          aria-pressed={hosting[r.key] === o.value}
                          onClick={() =>
                            setHosting((h) => ({
                              ...h,
                              [r.key]: o.value as ProfileAnswers["hosting"]["mail"],
                            }))
                          }
                        >
                          <OptIcon icon={optionIcon("hosting", o.value)} />
                          {o.labelJa}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn primary"
                  disabled={q.rows.some((r) => !hosting[r.key])}
                  onClick={() => void commit({ ...answers, hosting }, isLast)}
                >
                  次へ
                </button>
              </>
            ) : q.multi ? (
              <>
                <div className="opts">
                  {q.options.map((o) => {
                    const v = o.value as ProfileAnswers["remoteAccess"][number];
                    const on = remote.includes(v);
                    return (
                      <button
                        type="button"
                        key={o.value}
                        className="opt-btn"
                        aria-pressed={on}
                        onClick={() =>
                          setRemote((r) => (on ? r.filter((x) => x !== v) : [...r, v]))
                        }
                      >
                        <span className="opt-label">
                          <OptIcon icon={optionIcon(q.id, o.value)} />
                          {o.labelJa}
                        </span>
                        <span className="muted">
                          {on && hinted("remoteAccess")?.answers.remoteAccess?.includes(v) && (
                            <span
                              className="chip"
                              style={{ marginRight: 6 }}
                              title={hints?.reasonsJa.remoteAccess}
                            >
                              外部から推定
                            </span>
                          )}
                          {on ? "✓" : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={remote.length === 0}
                    onClick={() => void commit({ ...answers, remoteAccess: remote }, isLast)}
                  >
                    次へ
                  </button>
                </p>
              </>
            ) : (
              <div className="opts">
                {optionsForIndustry(q.options, answers.industry).map((o) => (
                  <button
                    type="button"
                    key={o.value}
                    className="opt-btn"
                    aria-pressed={(answers as Record<string, string | undefined>)[q.id] === o.value}
                    onClick={() => void commit({ ...answers, [q.id]: o.value } as Partial5, isLast)}
                  >
                    <span className="opt-label">
                      <OptIcon icon={optionIcon(q.id, o.value)} />
                      {o.labelJa}
                    </span>
                    <span className="muted">›</span>
                  </button>
                ))}
              </div>
            )}
            {error && (
              <p className="err small" style={{ marginTop: 10 }}>
                {error}
              </p>
            )}
            {step > 0 && (
              <p style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                >
                  ← 前の質問に戻る
                </button>
              </p>
            )}
          </>
        ) : (
          <>
            <h2>図が組み上がりました</h2>
            <p className="muted">担当者画面へ移ります…</p>
            <p style={{ marginTop: 12 }}>
              <a className="btn primary" href="#/staff">
                担当者画面へ
              </a>
            </p>
          </>
        )}
      </div>
      <div className="stage">
        {graph.nodes.length === 0 ? (
          <div style={{ padding: 40 }} className="muted">
            回答するたびに、ここに御社の構成図が組み上がります。
          </div>
        ) : (
          <Diagram layout={layout} graph={graph} hidden={hidden} appearing={appearing} />
        )}
      </div>
      <ConfirmDialog
        open={confirmReset}
        title="最初の5問をリセットしますか？"
        confirmLabel="リセットする"
        onConfirm={reset}
        onCancel={() => setConfirmReset(false)}
      >
        <p>
          いま選んでいる回答と、そこから作ったこのブラウザのカルテ（登録した対策の有無や数値を含む）を消して、1
          問目からやり直します。
        </p>
        <p>この操作は元に戻せません。書き出した JSON があれば、あとで読み込めます。</p>
      </ConfirmDialog>
    </div>
  );
}
