/**
 * 取引先・提供元の停止の公表の読解の確かめ（Issue #8、docs/article-trials/supply-oos.md）：
 * eval/.cache/trials/<id>/article.txt（取得済みの本文。git 管理外）を text で読ませ、被害の種類・入口・結論を表にする。新たな取得はしない。
 *
 *   node --disable-warning=ExperimentalWarning --env-file=<.env のパス> eval/trials/run-partner-outage.ts <id> [<id> ...]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { app } = await import("../../apps/web/src/server/app.ts");
const post = async (path: string, body: unknown) => {
  const res = await app.request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
};
const get = async (path: string) => (await app.request(`http://localhost${path}`)).json() as any;
const profiles: Record<string, unknown> = {};
for (const n of ["demo-bussan", "demo-seiko"])
  profiles[n] = (await get(`/api/examples/${n}`)).profile;

for (const id of process.argv.slice(2)) {
  const text = readFileSync(join(root, "eval", ".cache", "trials", id, "article.txt"), "utf8");
  const read = await post("/api/case/read", { input: { kind: "text", text } });
  if (read.status !== 200) {
    console.log(id, "read failed", read.status, JSON.stringify(read.json).slice(0, 200));
    continue;
  }
  const c = read.json.case;
  console.log(
    `## ${id}\n  damageType=${c.damageType} victim=${c.victim} clarity=${c.clarity} suspicious=${c.suspiciousInstructions?.length ?? 0}`,
  );
  console.log(
    "  steps:",
    c.steps.map((s: any) => `${s.tactic}[${s.source}]${s.techniques.join("+")}`).join(" / "),
  );
  for (const [name, profile] of Object.entries(profiles)) {
    const ev = await post("/api/evaluate", { case: c, profile, measureIds: [], answers: [] });
    const v = ev.json.verdict;
    console.log(
      `  ${name}: ${v?.result} 「${v?.headlineJa}」 template=${v?.templateId ?? "-"} stopped=${v?.impact?.stopped?.length ?? "-"}`,
    );
  }
}
