/**
 * 業種を切り替えて同じ攻撃を見る一場面（Issue 42）。
 * 5問の構成（VPN と保守接続、社内サーバ、クラウド同期のバックアップ）を固定し、業種の構成パターンだけを
 * 製造業／事務所型／医療・福祉に替えたカルテを /api/profile/from-answers で作り、同じ事例と対策で /api/evaluate にかける。
 * 止まる業務と日数、影響が業種で変わる様子を並べる。自社のカルテは変えない（判定はすべて engine）
 */
import { useState } from "react";
import { useApp } from "../hooks/useApp.tsx";
import { ApiError, api, type Evaluation } from "../lib/api.ts";
import { RESULT_SHORT, RESULT_TONE, yen } from "../lib/labels.ts";
import type { Pattern, ProfileAnswers } from "../lib/types.ts";
import { InfoButton } from "./InfoButton.tsx";

type Industry = {
  id: ProfileAnswers["industry"];
  site: ProfileAnswers["site"];
  /** 対応する構成パターン（knowledge/profiles）の id。名前は /api/knowledge の patterns[].labelJa から引く */
  pattern: Pattern["id"];
  /** patterns が読めていないときの名前 */
  labelJa: string;
};
const INDUSTRIES: Industry[] = [
  { id: "manufacturing", site: "factory", pattern: "manufacturing", labelJa: "製造業（工場あり）" },
  {
    id: "wholesale_service",
    site: "office_only",
    pattern: "office",
    labelJa: "事務所型（卸売・サービス）",
  },
  { id: "healthcare", site: "clinic", pattern: "healthcare", labelJa: "医療・福祉（診療所）" },
];

/** 業種の表示名：構成パターンの labelJa（knowledge/profiles）。無ければ固定の名前 */
export function industryLabel(ind: Industry, patterns: Pattern[] | undefined): string {
  return patterns?.find((p) => p.id === ind.pattern)?.labelJa ?? ind.labelJa;
}

/** 業種以外は同じ構成（対策は未登録のまま）。差が業種の構成パターンだけから来るようにする */
const BASE: Omit<ProfileAnswers, "industry" | "site"> = {
  hosting: { mail: "cloud", files: "onprem", core: "onprem", web: "provider" },
  remoteAccess: ["vpn", "vendor_remote"],
  backup: "cloud_sync",
};

export type IndustryResult = { labelJa: string; evaluation: Evaluation };

export function IndustrySwitch() {
  const app = useApp();
  const { theCase, profile, measureIds, knowledge } = app;
  const [results, setResults] = useState<IndustryResult[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [picked, setPicked] = useState(0);

  const label = (ind: Industry) => industryLabel(ind, knowledge?.patterns);

  async function run() {
    if (!theCase) return;
    setBusy(true);
    setError(undefined);
    try {
      const out = await Promise.all(
        INDUSTRIES.map(async (ind) => {
          const { profile: p } = await api.fromAnswers(
            { industry: ind.id, site: ind.site, ...BASE },
            `${label(ind)}の会社`,
          );
          // 金額の目安は自社のカルテの数値を借りる（業種だけを変えた比較にする）
          if (profile?.dailyRevenue) p.dailyRevenue = profile.dailyRevenue;
          if (profile?.employees) p.employees = profile.employees;
          if (profile?.typicalTransferJpy) p.typicalTransferJpy = profile.typicalTransferJpy;
          const evaluation = await api.evaluate({ case: theCase, profile: p, measureIds });
          return { labelJa: label(ind), evaluation };
        }),
      );
      setResults(out);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "通信に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  const cur = results?.[picked];
  return (
    <div className="panel industry">
      <h2>
        業種を切り替えて、同じ攻撃を見る
        <InfoButton title="この一場面について">
          <p>
            構成は同じ（VPN
            と保守ベンダーの遠隔接続、社内の業務サーバ、クラウド同期のバックアップ、対策は未登録）のまま、
            業種の構成パターンだけを替えたカルテで同じ事例を判定します。止まる業務と日数、影響が業種で変わる
            様子を見るための一場面で、自社のカルテは変えません。
            {knowledge?.patterns &&
              ` 業種のパターンは knowledge/profiles の ${knowledge.patterns.length} 種です。`}
          </p>
          <p>
            対策まで登録した架空の 3
            社（製造業、卸売・サービス、医療・福祉）は、上部の会社から選べます。
          </p>
        </InfoButton>
      </h2>
      <div className="row" style={{ marginTop: 8 }}>
        {results ? (
          INDUSTRIES.map((ind, i) => (
            <button
              type="button"
              key={ind.id}
              className="btn sm"
              aria-pressed={picked === i}
              onClick={() => setPicked(i)}
            >
              {label(ind)}
            </button>
          ))
        ) : (
          <button
            type="button"
            className="btn"
            disabled={busy || !theCase || app.busy}
            onClick={() => void run()}
          >
            {busy ? "3 業種で判定しています…" : "3 業種で比べる"}
          </button>
        )}
        {results && (
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void run()}>
            {busy ? "判定しています…" : "いまの対策でやり直す"}
          </button>
        )}
      </div>
      {error && (
        <p className="err small" style={{ marginTop: 6 }}>
          {error}
        </p>
      )}
      {results && cur && (
        <div className="industry-grid">
          {results.map((r, i) => {
            const v = r.evaluation.verdict;
            const tone = RESULT_TONE[v.result];
            return (
              <section
                key={r.labelJa}
                className={`industry-card tone-${tone}${i === picked ? " picked" : ""}`}
                aria-current={i === picked ? "true" : undefined}
              >
                <h3>{r.labelJa}</h3>
                <p className={`result fx-${tone === "ink" ? "ink" : tone}`}>
                  {RESULT_SHORT[v.result]}
                </p>
                <p className="small">
                  止まる業務：
                  {v.impact.stopped.length === 0
                    ? "なし"
                    : v.impact.stopped.map((s) => `${s.name}（${s.days} 日）`).join("、")}
                </p>
                <p className="small">
                  {v.impact.downtimeDays > 0 ? `停止 ${v.impact.downtimeDays} 日` : "停止なし"}
                  {v.impact.revenueImpactJpy ? `　売上影響 ${yen(v.impact.revenueImpactJpy)}` : ""}
                  {v.impact.moneyLossJpy ? `　流出 ${yen(v.impact.moneyLossJpy)}` : ""}
                  {v.impact.reportRequired ? "　個人情報保護委員会への報告義務あり" : ""}
                </p>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
