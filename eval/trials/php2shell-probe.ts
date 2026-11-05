/**
 * PHP2Shell の確認用：公開ホームページ（entry.web）に PHP の版を入れたカルテで、KEV の突き合わせと判定・一枚がどうなるかを出す。
 * Claude は呼ばず、ネットワークにも出ない。
 *
 *   node --disable-warning=ExperimentalWarning eval/trials/php2shell-probe.ts [--case <試験の id。既定は php-valtec3>] [--product <製品名>]
 *
 * 入力（どちらも git 管理外）
 *   - eval/.cache/kev-<日付>.json   CISA の KEV（https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json を手で置く）。最新の 1 つを使う
 *   - eval/.cache/trials/<id>/read.json   run-ir.ts が保存した読解（case）
 * 出力：版ごとの突き合わせ（該当／該当しない／未確認）と、判定・一枚の「何が起きるか」「今すぐ」。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  applyKev,
  buildOnePager,
  Case,
  CompanyProfile,
  evaluate,
  KevCatalog,
  loadKevProducts,
  loadKnowledge,
  matchKev,
  repoRoot,
} from "@uchidai/engine";

const { values } = parseArgs({
  options: { case: { type: "string" }, product: { type: "string" } },
});
const caseId = values.case ?? "php-valtec3";
const product = values.product ?? "PHP 本体（Web サイトを動かす PHP）";

const cacheDir = join(repoRoot, "eval", ".cache");
const kevFile = readdirSync(cacheDir)
  .filter((f) => /^kev-.*\.json$/.test(f))
  .sort()
  .at(-1);
if (!kevFile) throw new Error("eval/.cache/kev-<日付>.json がありません（CISA の KEV を置く）");
const catalog = KevCatalog.parse(JSON.parse(readFileSync(join(cacheDir, kevFile), "utf8")));
const readPath = join(cacheDir, "trials", caseId, "read.json");
if (!existsSync(readPath)) throw new Error(`${readPath} がありません`);
const theCase = Case.parse({
  ...(JSON.parse(readFileSync(readPath, "utf8")) as { case: object }).case,
  suspiciousInstructions: [],
});

const k = loadKnowledge();
const table = loadKevProducts();
console.log(
  `KEV ${catalog.catalogVersion}（${catalog.count} 件）／読解 ${caseId}：${theCase.title}\n`,
);

// 1. 版ごとの突き合わせ
for (const v of [
  "8.5.11",
  "8.5.12",
  "8.4.26",
  "8.4.27",
  "8.3.35",
  "8.3.36",
  "8.2.34",
  "8.2.35",
  "8.1.31",
  "7.4.33",
  "9.0.0",
]) {
  const m = matchKev({ product, version: v }, catalog, table);
  console.log(`${v.padEnd(7)} ${m.versionStatus.padEnd(12)} ${m.reasonJa}`);
}

// 2. 公開ホームページ（自社のサーバー）の PHP の版と、更新管理の登録（M1051）の組み合わせ。入口の段階の状態と理由を出す。
// カルテはデモ精工を土台にし（社内にファイルサーバーと基幹システムがある）、廃止済みのキャンペーンサイトを「現役の公開ホームページ」に差し替える。
// デモ精工の実際のカルテ（廃止済み）は変えない（ここはメモリ上の複製だけ）
const seiko = JSON.parse(readFileSync(join(repoRoot, "examples", "demo-seiko.json"), "utf8"));
for (const control of ["unknown", "present"] as const) {
  for (const version of ["8.4.26", "8.4.27"]) {
    const base = structuredClone(seiko);
    const webAsset = base.assets.find((a: { role: string }) => a.role === "entry.web");
    if (!webAsset) throw new Error("entry.web が無い");
    webAsset.side = "internal";
    delete webAsset.attrs.decommissioned;
    webAsset.label = "公開ホームページ（自社のサーバー）";
    webAsset.product = product;
    webAsset.version = version;
    webAsset.controls = [
      {
        mitigation: "M1051",
        status: control,
        evidence: control === "present" ? "registered" : "none",
      },
    ];
    const m = matchKev({ product, version }, catalog, table);
    const applied = applyKev(
      CompanyProfile.parse(base),
      webAsset.id,
      m,
      "2026-11-05T00:00:00Z",
    ).profile;
    const v = evaluate(theCase, applied, { knowledge: k });
    const op = buildOnePager(v, applied, k, { caseTitle: theCase.title });
    const first = v.paths[0]?.steps[0];
    console.log(
      `\n=== PHP ${version}（KEV：${m.versionStatus}）／更新管理 M1051：${control} → ${v.result}`,
    );
    console.log(`  入口の段階：${first?.state}（${first?.reasonJa}）`);
    console.log(`  見出し：${v.headlineJa}`);
    for (const w of op.whatHappensJa.slice(0, 2)) console.log(`  何が起きるか：${w.slice(0, 120)}`);
    console.log(
      `  初動：${op.measures
        .slice(0, 3)
        .map((x) => x.labelJa)
        .join(" / ")}`,
    );
  }
}
