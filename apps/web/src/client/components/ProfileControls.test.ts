import { describe, expect, it } from "vitest";
import { app } from "../../server/app.ts";
import type { ControlQuestion } from "../../shared/api.ts";
import type { PendingItem } from "../lib/pending.ts";
import { questionForRole } from "../lib/profile.ts";
import type { CompanyProfile } from "../lib/types.ts";
import { orderByPath } from "./ProfileControls.tsx";

type Asset = CompanyProfile["assets"][number];
const asset = (id: string, mitigations: string[]) =>
  ({
    id,
    kind: "system",
    role: "server",
    label: id,
    side: "internal",
    controls: mitigations.map((m) => ({ mitigation: m, status: "unknown", evidence: "none" })),
    attrs: {},
    attrEvidence: {},
  }) as unknown as Asset;
const item = (assetId: string, mitigation: string): PendingItem => ({
  assetId,
  assetLabel: assetId,
  mitigation,
  onPath: true,
});

describe("orderByPath（経路で問われている資産と行を先頭に）", () => {
  const assets = [
    asset("core", []),
    asset("server", ["M1030", "M1022"]),
    asset("vpn", ["M1051", "M1032", "M1042"]),
  ];
  it("経路の順に資産を並べ、資産の中では問われている行を先頭に。他は元の順のまま", () => {
    const out = orderByPath(assets, [item("vpn", "M1042"), item("server", "M1022")]);
    expect(out.map((a) => a.id)).toEqual(["vpn", "server", "core"]);
    expect(out[0]?.controls.map((c) => c.mitigation)).toEqual(["M1042", "M1051", "M1032"]);
    expect(out[1]?.controls.map((c) => c.mitigation)).toEqual(["M1022", "M1030"]);
  });
  it("経路の項目が無ければそのまま。元の配列は変えない", () => {
    expect(orderByPath(assets, [])).toBe(assets);
    orderByPath(assets, [item("vpn", "M1042")]);
    expect(assets.map((a) => a.id)).toEqual(["core", "server", "vpn"]);
    expect(assets[2]?.controls[0]?.mitigation).toBe("M1051");
  });
});

describe("questionForRole（「自分で答える」の質問を資産の役割に合わせる）", () => {
  const load = async (): Promise<ControlQuestion[]> => {
    const res = await app.request("/api/knowledge");
    const k = (await res.json()) as { controlQuestions: ControlQuestion[] };
    return k.controlQuestions;
  };
  it("ホームページの M1047 は「改ざん検知」、サーバの M1047 は「アクセスログ」、共通は「共有設定」", async () => {
    const qs = await load();
    const web = questionForRole(qs, "M1047", "entry.web", "監査");
    expect(web.textJa).toContain("改ざん");
    expect(web.textJa).not.toContain("共有設定");
    expect(web.choices.map((c) => c.status)).toEqual(["present", "absent", "unknown"]);
    expect(web.choices.some((c) => c.labelJa === "分からない")).toBe(true);
    expect(questionForRole(qs, "M1047", "server", "監査").textJa).toContain("アクセスログ");
    expect(questionForRole(qs, "M1047", "cloud.storage", "監査").textJa).toContain("共有設定");
    // byRole は画面に残さない（表示に要らない）。役割の文言に hintJa が無ければ共通の hintJa も出さない
    expect((web as { byRole?: unknown }).byRole).toBeUndefined();
    const vpnUpdate = questionForRole(qs, "M1051", "entry.vpn", "更新");
    const webUpdate = questionForRole(qs, "M1051", "entry.web", "更新");
    expect(webUpdate.textJa).toContain("CMS");
    expect(webUpdate.hintJa).toContain("事業者側");
    expect(vpnUpdate.textJa).toContain("修正プログラム");
  });
  it("質問表に無い緩和策は 3 択の素の質問", async () => {
    const qs = await load();
    const q = questionForRole(qs, "M9999", "server", "何かの対策");
    expect(q.textJa).toBe("何かの対策はありますか");
    expect(q.choices.map((c) => c.labelJa)).toEqual(["あり", "なし", "分からない"]);
  });
});
