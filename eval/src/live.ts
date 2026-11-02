/**
 * `pnpm eval --live`：Claude を実際に呼び、記録（eval/recordings/*.json）を更新する。
 * - 記事の原文は eval/.cache/<caseId>.txt に置く（git 管理外）。無ければ source.url（PDF なら source.pages）から取り込む
 * - 知見あり（with-knowledge）と知見なし（without-knowledge）の 2 モードで読む
 * - どちらも verifyCase を通した結果を output に、検証前の生の出力を raw に残す
 * - 知見なしの Claude による対策一覧は eval/recordings/mitigations/<caseId>.json に残す（採点対象外）
 * - リクエストヘッダや API キーは一切保存しない
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { AttackData } from "@uchidai/engine";
import {
  downloadBytes,
  fetchArticle,
  listGenericMitigations,
  type ReadKnowledge,
  readCase,
  readCaseWithoutKnowledge,
  verifyCase,
} from "@uchidai/llm";
// TODO(S0): engine の index から knowledge.ts が export されたら "@uchidai/engine" からの import に戻す
import { loadAttack, loadLabels } from "../../packages/engine/src/knowledge.ts";
import type { GoldCase, Recording } from "./types.ts";

export type LiveDirs = { cache: string; recordings: string };
export type LiveMode = Recording["mode"];

/** 記事の原文を用意する（キャッシュがあればそれ、無ければ取得してキャッシュに保存） */
export async function ensureArticle(gold: GoldCase, dirs: LiveDirs): Promise<string> {
  const txt = join(dirs.cache, `${gold.id}.txt`);
  if (existsSync(txt)) return readFileSync(txt, "utf8");
  mkdirSync(dirs.cache, { recursive: true });

  const url = gold.source.url;
  const isPdf = /\.pdf(\?|#|$)/i.test(url);
  let text: string;
  if (isPdf) {
    const pdfPath = join(dirs.cache, basename(new URL(url).pathname));
    if (!existsSync(pdfPath)) {
      console.log(`  PDF を取得: ${url}`);
      const { data } = await downloadBytes(url);
      writeFileSync(pdfPath, data);
    }
    const data = new Uint8Array(readFileSync(pdfPath));
    const input: Parameters<typeof fetchArticle>[0] = { kind: "pdf", data, sourceUrl: url };
    if (gold.source.pages) input.pages = gold.source.pages;
    const article = await fetchArticle(input);
    text = article.text;
  } else {
    console.log(`  記事を取得: ${url}`);
    text = (await fetchArticle({ kind: "url", url })).text;
  }
  writeFileSync(txt, text);
  return text;
}

function summarize(report: ReturnType<typeof verifyCase>["report"]): Recording["verification"] {
  return {
    ...report.counts,
    replaced: report.replacedTechniques.map((r) => `${r.from}->${r.to}`),
    droppedTechniques: report.droppedTechniques.map((d) => `${d.id}(${d.reason})`),
    droppedQuotes: report.droppedQuotes.length,
    suspiciousInstructions: report.suspiciousInstructions.length,
  };
}

export async function recordCase(
  gold: GoldCase,
  mode: LiveMode,
  text: string,
  attack: AttackData,
  knowledge: ReadKnowledge,
  dirs: LiveDirs,
): Promise<Recording> {
  const meta = { url: gold.source.url, title: gold.title };
  const read =
    mode === "with-knowledge"
      ? await readCase(text, { attack, knowledge, ...meta })
      : await readCaseWithoutKnowledge(text, meta);
  const { case: c, report } = verifyCase(read.raw, text, attack, { url: gold.source.url });
  const rec: Recording = {
    caseId: gold.id,
    mode,
    model: read.model,
    recordedAt: new Date().toISOString(),
    note:
      mode === "with-knowledge"
        ? "ATT&CK の手法一覧と日本語ラベルを渡して読解。verifyCase 通過後の出力。根拠文は IPA 事例集からの短い抜粋（出典は eval/cases の source）"
        : "知見ファイル（ラベル・型紙・手法一覧）を一切渡さずに読解。verifyCase 通過後の出力。根拠文は IPA 事例集からの短い抜粋（出典は eval/cases の source）",
    attackVersion: attack.version,
    output: {
      title: c.title,
      damageType: c.damageType,
      clarity: c.clarity,
      steps: c.steps.map((s) => ({
        tactic: s.tactic,
        techniques: s.techniques,
        source: s.source,
        ...(s.quote !== undefined ? { quote: s.quote } : {}),
        ...(s.summaryJa !== undefined ? { summaryJa: s.summaryJa } : {}),
      })),
      suspiciousInstructions: c.suspiciousInstructions,
    },
    raw: read.raw,
    verification: summarize(report),
  };
  mkdirSync(dirs.recordings, { recursive: true });
  writeFileSync(
    join(dirs.recordings, `${gold.id}.${mode}.json`),
    `${JSON.stringify(rec, null, 2)}\n`,
  );
  return rec;
}

export async function recordMitigations(
  gold: GoldCase,
  text: string,
  attack: AttackData,
  dirs: LiveDirs,
): Promise<void> {
  const r = await listGenericMitigations(text, { attack, url: gold.source.url, title: gold.title });
  const dir = join(dirs.recordings, "mitigations");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${gold.id}.json`),
    `${JSON.stringify(
      {
        caseId: gold.id,
        model: r.model,
        recordedAt: new Date().toISOString(),
        note: "知見なしの Claude に「この事例への対策」を緩和策 ID つきで列挙させたもの。ID の実在だけ確認済み。効く／効かない／経路の外の振り分けは engine 側",
        attackVersion: attack.version,
        counts: r.counts,
        items: r.items,
      },
      null,
      2,
    )}\n`,
  );
}

export type LiveOptions = {
  caseIds?: string[];
  modes: LiveMode[];
  mitigations: boolean;
};

export async function runLive(cases: GoldCase[], dirs: LiveDirs, opts: LiveOptions): Promise<void> {
  const attack = loadAttack();
  const labels = loadLabels();
  const knowledge: ReadKnowledge = { labels };
  const targets = opts.caseIds ? cases.filter((c) => opts.caseIds?.includes(c.id)) : cases;
  for (const gold of targets) {
    console.log(`\n[${gold.id}] ${gold.title}`);
    const text = await ensureArticle(gold, dirs);
    console.log(`  原文 ${text.length} 文字`);
    for (const mode of opts.modes) {
      const rec = await recordCase(gold, mode, text, attack, knowledge, dirs);
      const v = rec.verification;
      console.log(
        `  ${mode}: ${rec.output.damageType}/${rec.output.clarity}、段階 ${rec.output.steps.length}（検証: 手法 ${v?.techniquesIn}→${v?.techniquesOut}、根拠文 ${v?.quotesIn}→${v?.quotesOut}、置換 ${v?.replaced?.length ?? 0}）`,
      );
    }
    if (opts.mitigations) {
      await recordMitigations(gold, text, attack, dirs);
      console.log("  対策一覧（知見なし）を記録");
    }
  }
}
