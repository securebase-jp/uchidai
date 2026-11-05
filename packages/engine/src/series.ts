/**
 * 同じ事故の続報の系列（第1報、第2報、…）の比較（TRIAL-I-012）。
 * 各報を別々に読んだ結果（Case）を並べ、段階ごとの確度・入口の種類・被害額・漏えいした情報の違いを
 * **プログラムが決定的に**出す。Claude の言い換えは使わない（文はここの固定の書き方だけ）。
 */

import { formatJpy } from "./impact.ts";
import type { Knowledge } from "./knowledge.ts";
import type { Case, CaseStep, StepCertainty } from "./types.ts";

/** 系列の一件：画面に出す名前（「第2報」）と、その報を読んだ結果 */
export type SeriesReportInput = { label: string; date?: string | undefined; case: Case };

/** 確度の言い方（段階の表のセルと変化の文に使う） */
export const CERTAINTY_LABEL_JA: Record<StepCertainty, string> = {
  confirmed: "確認",
  possible: "可能性",
  exposed_only: "閲覧できる状態",
  no_trace: "痕跡なし",
  claimed: "攻撃者の主張",
  not_stated: "記載なし",
};

export type SeriesCell = {
  /** 画面に出す短い言い方（「分かっていません」「VPN 装置（記載）」「可能性」「確認」） */
  textJa: string;
  certainty: StepCertainty;
  source: CaseStep["source"];
};

export type SeriesRow = {
  tactic: string;
  labelJa: string;
  /** 報ごとのセル。その報にこの段階が無ければ null */
  cells: (SeriesCell | null)[];
  /** 前の報（読めた報）から言い方が変わった報の添字 */
  changedAt: number[];
};

export type SeriesTransition = {
  /** 前の報と、この報の名前 */
  fromLabel: string;
  toLabel: string;
  /** 変わったこと（丁寧な言い方の文。無ければ空） */
  changesJa: string[];
};

export type SeriesView = {
  reports: {
    label: string;
    date?: string;
    /** 段階を一つも読み取れなかった報（短い続報など）。比較からは外す */
    readable: boolean;
    reportedLossJpy?: number;
    leakedDataJa: string[];
  }[];
  rows: SeriesRow[];
  transitions: SeriesTransition[];
  /** 一枚に足す「前の報から変わったこと」（1〜2 文）。変わったことが無ければ、その旨を一文 */
  summaryJa: string[];
};

/** ATT&CK の戦術の並び（攻撃の流れの順）。無いものは後ろ */
const TACTIC_ORDER = [
  "TA0043",
  "TA0042",
  "TA0001",
  "TA0002",
  "TA0003",
  "TA0004",
  "TA0005",
  "TA0006",
  "TA0007",
  "TA0008",
  "TA0009",
  "TA0011",
  "TA0010",
  "TA0040",
];
const orderOf = (t: string) => {
  const i = TACTIC_ORDER.indexOf(t);
  return i < 0 ? TACTIC_ORDER.length : i;
};

/** 同じ戦術の段階が複数あるときは、確度が高いほう（confirmed、記載）を代表にする */
function pickStep(steps: CaseStep[], tactic: string): CaseStep | undefined {
  const same = steps.filter((s) => s.tactic === tactic);
  const rank = (s: CaseStep) => ((s.certainty ?? "confirmed") === "confirmed" ? 0 : 1);
  return [...same].sort((a, b) => rank(a) - rank(b))[0];
}

function cellOf(step: CaseStep, k: Pick<Knowledge, "entryKinds">): SeriesCell {
  const certainty = step.certainty ?? "confirmed";
  const source = step.source;
  // 入口：記載が無いなら「分かっていません」。分かるなら入口の種類（VPN 装置）と、記載か推定か
  if (step.tactic === "TA0001") {
    if (certainty === "not_stated" || source === "unknown")
      return { textJa: "分かっていません", certainty, source };
    const kind = step.entryKind ? k.entryKinds.find((e) => e.id === step.entryKind)?.labelJa : "";
    const how = source === "stated" ? "記載" : "推定";
    const base = kind ? `${kind}（${how}）` : `入口あり（${how}）`;
    return {
      textJa: certainty === "confirmed" ? base : `${base}・${CERTAINTY_LABEL_JA[certainty]}`,
      certainty,
      source,
    };
  }
  return {
    textJa:
      source === "inferred"
        ? `${CERTAINTY_LABEL_JA[certainty]}（推定）`
        : CERTAINTY_LABEL_JA[certainty],
    certainty,
    source,
  };
}

const quote = (s: string) => `「${s}」`;

/**
 * 報の並び（古い順）を比べる。段階が一つも読み取れなかった報（短い続報が out_of_scope になったなど）は、
 * 表には列を残すが、前後の比較からは外す（読めなかったものを「変わった」と言わない）
 */
export function compareSeries(
  reports: SeriesReportInput[],
  k: Pick<Knowledge, "entryKinds" | "leakKinds" | "labels" | "damageTypes">,
): SeriesView {
  const readable = reports.map((r) => r.case.steps.length > 0);
  const leakLabel = (id: string) => k.leakKinds.find((l) => l.id === id)?.labelJa ?? id;
  const typeLabel = (id: string) => k.damageTypes.find((d) => d.id === id)?.labelJa ?? id;

  // 段階の表
  const tactics = [...new Set(reports.flatMap((r) => r.case.steps.map((s) => s.tactic)))].sort(
    (a, b) => orderOf(a) - orderOf(b),
  );
  const rows: SeriesRow[] = tactics.map((tactic) => {
    const cells = reports.map((r) => {
      const step = pickStep(r.case.steps, tactic);
      return step ? cellOf(step, k) : null;
    });
    const changedAt: number[] = [];
    let prev: number | undefined;
    cells.forEach((cell, i) => {
      if (!readable[i]) return;
      if (prev !== undefined && cell?.textJa !== cells[prev]?.textJa) changedAt.push(i);
      prev = i;
    });
    return { tactic, labelJa: k.labels.tactics[tactic] ?? tactic, cells, changedAt };
  });

  // 報ごとの事実（被害額、漏えいした情報）
  const meta = reports.map((r) => ({
    label: r.label,
    ...(r.date ? { date: r.date } : {}),
    readable: r.case.steps.length > 0,
    ...(r.case.reportedLossJpy !== undefined ? { reportedLossJpy: r.case.reportedLossJpy } : {}),
    leakedDataJa: (r.case.leakedData ?? []).map(leakLabel),
  }));

  // 前の報（読めた報）との差
  const transitions: SeriesTransition[] = [];
  let prevIdx: number | undefined;
  reports.forEach((r, i) => {
    if (!readable[i]) return;
    if (prevIdx !== undefined) {
      const p = reports[prevIdx] as SeriesReportInput;
      const changes: string[] = [];
      // 被害の種類（ransomware → data_breach など）
      if (p.case.damageType !== r.case.damageType && p.case.damageType !== "out_of_scope")
        changes.push(
          `被害の種類が${quote(typeLabel(p.case.damageType))}から${quote(typeLabel(r.case.damageType))}に変わりました`,
        );
      // 段階（入口を先に）
      for (const row of rows) {
        if (!row.changedAt.includes(i)) continue;
        const before = row.cells[prevIdx];
        const after = row.cells[i];
        if (!after) continue; // 段階が書かれなくなった（短い報）ことは「変わった」とは言わない
        changes.push(
          before
            ? row.tactic === "TA0001"
              ? `入口が${quote(before.textJa)}から${quote(after.textJa)}に変わりました`
              : `${quote(row.labelJa)}が${quote(before.textJa)}から${quote(after.textJa)}に変わりました`
            : row.tactic === "TA0001"
              ? `入口が${quote(after.textJa)}と書かれました`
              : `${quote(row.labelJa)}が${quote(after.textJa)}と書かれました`,
        );
      }
      // 被害額
      const lp = p.case.reportedLossJpy;
      const ln = r.case.reportedLossJpy;
      if (ln !== undefined && lp === undefined)
        changes.push(`被害額が${formatJpy(ln)}と公表されました`);
      else if (ln !== undefined && lp !== undefined && ln !== lp)
        changes.push(`被害額が${formatJpy(lp)}から${formatJpy(ln)}に変わりました`);
      // 漏えいした情報
      const lpSet = new Set(p.case.leakedData ?? []);
      const lnSet = new Set(r.case.leakedData ?? []);
      const added = [...lnSet].filter((x) => !lpSet.has(x)).map(leakLabel);
      const removed = [...lpSet].filter((x) => !lnSet.has(x)).map(leakLabel);
      if (added.length > 0)
        changes.push(`漏えいした情報に${added.map(quote).join("、")}が加わりました`);
      if (removed.length > 0)
        changes.push(`漏えいした情報から${removed.map(quote).join("、")}が外れました`);
      transitions.push({ fromLabel: p.label, toLabel: r.label, changesJa: changes });
    }
    prevIdx = i;
  });

  return { reports: meta, rows, transitions, summaryJa: summarize(transitions, readable) };
}

/** 一枚に足す文：変わった報のうち新しい 2 つまで。1 つの報の変化は 3 つまで書き、残りは件数で示す */
function summarize(transitions: SeriesTransition[], readable: boolean[]): string[] {
  const changed = transitions.filter((t) => t.changesJa.length > 0);
  if (changed.length === 0)
    return readable.filter(Boolean).length < 2
      ? []
      : ["報の間で、攻撃の流れの確度、被害額、漏えいした情報に変わったところはありません。"];
  return changed.slice(-2).map((t) => {
    const shown = t.changesJa.slice(0, 3);
    const rest = t.changesJa.length - shown.length;
    return `${t.toLabel}で、${shown.join("。また、")}${rest > 0 ? `。ほかに ${rest} 件の変化があります` : ""}。`;
  });
}
