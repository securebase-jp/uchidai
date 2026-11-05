import { describe, expect, it } from "vitest";
import { app } from "../app.ts";

// biome-ignore lint/suspicious/noExplicitAny: テストでは応答の形を緩く読む
type Loose = any;
const loose = async (res: Response | Promise<Response>): Promise<Loose> => (await res).json();
const post = (path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function fixture() {
  const c = await loose(app.request("/api/case/recorded/ipa-case-1"));
  const p = await loose(app.request("/api/examples/demo-seiko"));
  return { theCase: c.case, profile: p.profile };
}

describe("POST /api/onepager", () => {
  it("架空企業と事例 1 で、専門用語なしの一枚とグラフ・判定を返す（テンプレート文）", async () => {
    const { theCase, profile } = await fixture();
    const res = await post("/api/onepager", { case: theCase, profile, rewrite: false });
    expect(res.status).toBe(200);
    const body = await loose(res);
    expect(body.onePager.result).toBe("breached");
    expect(body.onePager.fictional).toBe(true);
    expect(body.onePager.headlineJa).toContain("大丈夫ではありません");
    expect(body.onePager.whatHappensJa.length).toBeGreaterThan(1);
    expect(body.onePager.stopped[0].name).toBe("受注・生産管理");
    expect(body.onePager.measures.map((m: { id: string }) => m.id)).toContain("vpn-update");
    expect(body.text.source).toBe("template");
    expect(body.graph.nodes.length).toBeGreaterThan(5);
    expect(body.verdict.result).toBe("breached");
    for (const line of body.onePager.whatHappensJa) expect(line).not.toMatch(/\bT\d{4}|M\d{4}/);
  });
  it("reports（複数の報を別々に読んだ結果）があるときだけ、前の報から変わったことを返す（TRIAL-I-012）", async () => {
    const { theCase, profile } = await fixture();
    const plain = await loose(post("/api/onepager", { case: theCase, profile, rewrite: false }));
    expect(plain.changes).toBeUndefined();
    const withReports = await loose(
      post("/api/onepager", {
        case: theCase,
        profile,
        rewrite: false,
        reports: [
          {
            label: "第1報",
            case: {
              ...theCase,
              steps: [
                { ...theCase.steps[0], certainty: "not_stated", source: "unknown" },
                ...theCase.steps.slice(1),
              ],
            },
          },
          { label: "第2報", case: theCase },
        ],
      }),
    );
    // 一枚そのものは、reports の有無で変わらない
    expect(withReports.onePager).toEqual(plain.onePager);
    expect(withReports.changes.summaryJa).toHaveLength(1);
    expect(withReports.changes.summaryJa[0]).toMatch(/^第2報で、.*入口が「分かっていません」から/);
    // 1 件や 6 件は受け付けない
    const one = await post("/api/onepager", {
      case: theCase,
      profile,
      rewrite: false,
      reports: [{ label: "第1報", case: theCase }],
    });
    expect(one.status).toBe(400);
  });
  it("対策「VPN 装置の更新」を適用すると止められる", async () => {
    const { theCase, profile } = await fixture();
    const body = await loose(
      post("/api/onepager", { case: theCase, profile, measureIds: ["vpn-update"], rewrite: false }),
    );
    expect(body.onePager.result).toBe("blocked");
    expect(body.measures.map((m: { id: string }) => m.id)).toEqual(["vpn-update"]);
  });
  it("キーが無いときは rewrite=true でもテンプレート文で返す", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { theCase, profile } = await fixture();
      const body = await loose(post("/api/onepager", { case: theCase, profile }));
      expect(body.text.source).toBe("template");
      expect(body.text.noteJa).toContain("キー");
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
  it("入力の形が違えば 400", async () => {
    expect((await post("/api/onepager", { case: {} })).status).toBe(400);
  });
});

describe("GET /api/demo/audio", () => {
  it("一覧は常に返る（音声が無ければ空）", async () => {
    const body = await loose(app.request("/api/demo/audio"));
    expect(typeof body.available).toBe("object");
  });
  it("場面番号の検証と 404", async () => {
    expect((await app.request("/api/demo/audio/abc")).status).toBe(400);
    expect((await app.request("/api/demo/audio/49")).status).toBe(404);
  });
});
