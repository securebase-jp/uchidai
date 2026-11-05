/**
 * なりすまし送金（bec-invoice）に、SNS・チャットで社長や取引先を名乗って接触される手口を足した（TRIAL-B-006）。
 * 接触の手法は T1566.003。新しい対策（UD-05 依頼に応じない運用、UD-06 二重承認、UD-07 上限）は、この手口でだけ効き、
 * メールの手口の判定と、乗っ取りを伴う bec の判定は変わらない
 */
import { beforeAll, describe, expect, it } from "vitest";
import { evaluate } from "./evaluate.ts";
import { profileFromAnswers } from "./graph.ts";
import { type Knowledge, loadKnowledge } from "./knowledge.ts";
import { applyMeasures } from "./measures.ts";
import { effectiveMeasures } from "./onepager.ts";
import type { Case, CompanyProfile } from "./types.ts";

// 社長を名乗る者が SNS で接触し、グループを作らせ、口座の残高を聞き出して送金させた（記事の要約。本文は入れない）
const snsCase: Case = {
  title: "社長を名乗る SNS の接触からグループが作られ、送金させられた",
  damageType: "bec",
  clarity: "clear",
  suspiciousInstructions: [],
  steps: [
    { tactic: "TA0001", techniques: ["T1566.003"], source: "stated" },
    { tactic: "TA0002", techniques: ["T1204"], source: "stated" },
    { tactic: "TA0040", techniques: ["T1657"], source: "stated" },
  ],
};
// 同じ手口をメールで受けた事案（比べるため）
const mailCase: Case = {
  ...snsCase,
  title: "取引先を装う偽の請求メールで送金させられた",
  steps: [
    { tactic: "TA0001", techniques: ["T1566.002"], source: "stated" },
    { tactic: "TA0002", techniques: ["T1204"], source: "stated" },
    { tactic: "TA0040", techniques: ["T1657"], source: "stated" },
  ],
};

let k: Knowledge;
let frame: CompanyProfile;
beforeAll(() => {
  k = loadKnowledge();
  frame = profileFromAnswers(
    {
      industry: "wholesale_service",
      site: "office_only",
      hosting: { mail: "cloud", files: "onprem", core: "onprem", web: "provider" },
      remoteAccess: ["rdp"],
      backup: "same_network",
    },
    k.patterns,
    "試験用商事",
    k.sites,
  );
});

type Status = "present" | "absent";
/** 経理担当の対策を指定の状態にする。指定のない UD-01（折り返し確認）は「なし」に確定する（5 問のカルテでは未確認） */
const withAccounting = (controls: [string, Status][]) =>
  applyMeasures(
    frame,
    [
      ...(controls.some(([m]) => m === "UD-01") ? [] : [["UD-01", "absent"] as [string, Status]]),
      ...controls,
    ].map(([mitigation, status]) => ({
      id: `acc-${mitigation}-${status}`,
      labelJa: mitigation,
      patches: [{ role: "person.accounting", mitigation, status }],
    })),
  );
/** 5 問のカルテの「送金の手順が未確認」を、なしに確定した経理担当 */
const bare = () => withAccounting([]);

describe("SNS・チャットで接触される手口（bec-invoice）", () => {
  it("型紙は接触の手法 T1566.003 を受け入れ、手法は ATT&CK にあり、ラベルがある", () => {
    const t = k.templates.find((x) => x.id === "bec-invoice");
    const invoice = t?.stages.find((s) => s.id === "invoice");
    expect(invoice?.accepts).toContain("T1566.003");
    expect(invoice?.labelJa).toContain("SNS");
    expect(k.attack.techniques.some((x) => x.id === "T1566.003" && !x.revoked)).toBe(true);
    expect(k.labels.techniques["T1566.003"]).toBeDefined();
  });

  it("SNS の事案は bec-invoice に対応づき、接触の段階が T1566.003 になる（乗っ取りの bec にはならない）", () => {
    const v = evaluate(snsCase, bare(), { knowledge: k });
    expect(v.templateId).toBe("bec-invoice");
    const step = v.paths[0]?.steps.find((s) => s.stageId === "invoice");
    expect(step?.technique).toBe("T1566.003");
    expect(step?.source).toBe("stated");
    expect(step?.ruleId).toBe("bec_invoice.sns");
    expect(v.result).toBe("breached");
  });

  it("対策が無い会社では、SNS でもメールでも大丈夫ではない", () => {
    expect(evaluate(snsCase, bare(), { knowledge: k }).result).toBe("breached");
    expect(evaluate(mailCase, bare(), { knowledge: k }).result).toBe("breached");
  });

  it("SNS の依頼に応じない運用 / 二重承認 / 折り返し確認 のどれかで止められる", () => {
    for (const m of ["UD-05", "UD-06", "UD-01"] as const) {
      const v = evaluate(snsCase, withAccounting([[m, "present"]]), { knowledge: k });
      expect(v.result, m).toBe("blocked");
      expect(v.paths[0]?.steps.find((s) => s.stageId === "invoice")?.state).toBe("blocked");
    }
  });

  it("上限だけでは止まらず、被害を抑える（mitigated）。研修だけは人の段階のまま", () => {
    const limit = evaluate(snsCase, withAccounting([["UD-07", "present"]]), { knowledge: k });
    expect(limit.result).toBe("mitigated");
    expect(limit.paths[0]?.steps.find((s) => s.stageId === "invoice")?.state).toBe("recoverable");
    const training = evaluate(snsCase, withAccounting([["M1017", "present"]]), { knowledge: k });
    expect(training.result).toBe("breached");
    expect(training.paths[0]?.steps.find((s) => s.stageId === "invoice")?.state).toBe("human");
  });

  it("送金の手順が未確認なら、確認中（pending）のまま（5 問のカルテの既存の挙動）", () => {
    const v = evaluate(snsCase, frame, { knowledge: k });
    expect(v.result).toBe("pending");
  });

  it("SNS 用の新しい対策は、メールの手口の判定を変えない（UD-05 だけではメールの偽の請求は止まらない）", () => {
    const v = evaluate(mailCase, withAccounting([["UD-05", "present"]]), { knowledge: k });
    expect(v.result).toBe("breached");
    expect(v.paths[0]?.steps.find((s) => s.stageId === "invoice")?.ruleId).toBe("bec_invoice.mail");
  });

  it("対策ボタンは SNS の事案にだけ並び、費用は出典のない単価を作らない", () => {
    const ids = (c: Case) =>
      effectiveMeasures(evaluate(c, bare(), { knowledge: k }), k.measures, bare()).map(
        (e) => e.measure.id,
      );
    const sns = ids(snsCase);
    for (const id of ["sns-group-refuse", "transfer-dual-approval", "transfer-limit"])
      expect(sns).toContain(id);
    const mail = ids(mailCase);
    for (const id of ["sns-group-refuse", "transfer-dual-approval", "transfer-limit"])
      expect(mail).not.toContain(id);
    for (const id of ["sns-group-refuse", "transfer-dual-approval", "transfer-limit"]) {
      const c = k.costs.measures.find((x) => x.measureId === id);
      expect(c?.basis === "internal" || c?.basis === "quote").toBe(true);
    }
  });
});
