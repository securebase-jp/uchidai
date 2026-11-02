/**
 * AI攻撃者の評価：`pnpm eval:attacker`
 *
 * - 記録 eval/recordings/attacker.<profileId>.json（実際に実行した下見の入力・生の出力・検証結果）を読み、
 *   候補を現在の知識（ATT&CK、ルール表）で検証し直して、仕込んだ経路（entry.vendor_remote → core）を
 *   見つけたか、破棄が何件かを数える
 * - 知見なし比較の記録 eval/recordings/compare.<caseId>.json を読み、振り分けの件数を数える
 * - 結果を eval/results/attacker-<日時>.json と eval/RESULTS.md に 1 行で記録する
 *
 * オプション：
 *   --live             Claude を呼んで下見の記録を作り直す（ANTHROPIC_API_KEY が必要）
 *   --compare-live     Claude を呼んで知見なしの対策一覧の記録を作り直す（記事の原文 eval/.cache/<caseId>.txt が必要）
 *   --profile <id>     カルテ（既定 demo-seiko）
 *   --case <id>        比較の事例（既定 ipa-case-1）
 *   --runs <n>         --live で続けて実行する回数（既定 1）
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  type AttackPath,
  buildGraph,
  Case,
  evaluate,
  loadKnowledge,
  loadProfile,
  repoRoot,
  terminalRoles,
} from "@uchidai/engine";
import {
  type AbstractedProfile,
  ATTACKER_VERSION,
  type AttackerRecording,
  AttackerRecording as AttackerRecordingSchema,
  abstractProfile,
  attackerRecordingPath,
  buildReconLog,
  type CompareRecording,
  CompareRecording as CompareRecordingSchema,
  compareGenericMitigations,
  compareRecordingPath,
  leakedTerms,
  listGenericMitigations,
  profileBannedTerms,
  reconnoiter,
  renderAbstracted,
  screenRecording,
  toGenericMitigations,
  validateCandidates,
} from "@uchidai/llm";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dirs = {
  recordings: join(root, "recordings"),
  results: join(root, "results"),
  cache: join(root, ".cache"),
};

/** 仕込んだ経路：保守ベンダーの遠隔接続から中核へ */
export const PLANTED = { entry: "entry.vendor_remote", goal: "core" };

export function foundPlanted(paths: AttackPath[]): boolean {
  return paths.some(
    (p) =>
      p.reachedCore &&
      p.steps[0]?.role === PLANTED.entry &&
      p.steps[p.steps.length - 1]?.role === PLANTED.goal,
  );
}

type Options = {
  live: boolean;
  compareLive: boolean;
  profileId: string;
  caseId: string;
  runs: number;
};

function parseOptions(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    options: {
      live: { type: "boolean", default: false },
      "compare-live": { type: "boolean", default: false },
      profile: { type: "string", default: "demo-seiko" },
      case: { type: "string", default: "ipa-case-1" },
      runs: { type: "string", default: "1" },
    },
    strict: true,
  });
  return {
    live: values.live,
    compareLive: values["compare-live"],
    profileId: values.profile,
    caseId: values.case,
    runs: Math.max(1, Number(values.runs) || 1),
  };
}

export async function runAttackerLive(profileId: string, runs: number): Promise<AttackerRecording> {
  const k = loadKnowledge();
  const profile = loadProfile(join(repoRoot, "examples", `${profileId}.json`));
  const graph = buildGraph(profile, k.roles);
  const goals = [...terminalRoles(k)].filter((r) => r === "core");
  const abstracted: AbstractedProfile = abstractProfile(profile, graph, k.roles, {
    labels: k.labels,
    goals: goals.length > 0 ? goals : ["core"],
  });
  const rendered = renderAbstracted(abstracted);
  const leaked = leakedTerms(profile, rendered);
  if (leaked.length > 0)
    throw new Error(`抽象化カルテに固有名詞が残っています: ${leaked.join(", ")}`);
  const extraBannedTerms = profileBannedTerms(profile);

  const path = attackerRecordingPath(profileId);
  const previousRuns: NonNullable<AttackerRecording["previousRuns"]> = [];
  let attempts = 0;
  if (existsSync(path)) {
    const prev = AttackerRecordingSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    attempts = prev.attempts;
    previousRuns.push(...(prev.previousRuns ?? []));
    previousRuns.push({
      recordedAt: prev.recordedAt,
      model: prev.model,
      raw: prev.raw,
      found: foundPlanted(prev.paths as AttackPath[]),
    });
  }

  let rec: AttackerRecording | undefined;
  for (let i = 0; i < runs; i++) {
    attempts += 1;
    console.log(`下見 ${attempts} 回目（${profileId}）…`);
    const r = await reconnoiter(abstracted, {
      attack: k.attack,
      labels: k.labels,
      templates: k.templates,
      rules: k.rules,
      extraBannedTerms,
    });
    const validated = validateCandidates(r.candidates, graph, profile, k);
    const log = buildReconLog({
      abstracted,
      attackVersion: k.attack.version,
      candidates: r.candidates,
      validated,
      screened: r.discarded,
      recorded: false,
      model: r.model,
      techniqueLabel: (id) => k.labels.techniques[id],
    });
    for (const l of log) console.log(`  > ${l}`);
    const found = foundPlanted(validated.paths);
    console.log(
      `  仕込んだ経路（${PLANTED.entry} → ${PLANTED.goal}）：${found ? "発見" : "未発見"}`,
    );
    if (rec)
      previousRuns.push({
        recordedAt: rec.recordedAt,
        model: rec.model,
        raw: rec.raw,
        found: foundPlanted(rec.paths as AttackPath[]),
      });
    rec = {
      profileId,
      model: r.model,
      recordedAt: new Date().toISOString(),
      attackVersion: k.attack.version,
      attackerVersion: ATTACKER_VERSION,
      note: "実際の出力の記録（作り物の台本ではない）。Claude に渡したのは役割の枠に抽象化したカルテと ATT&CK の手法一覧だけ。raw は検証前の生の出力、paths は engine の 4 点検証（手法 ID・役割・つながり・判定ルール）を通った経路。リクエストヘッダは保存していない",
      attempts,
      input: { abstracted, rendered },
      raw: r.raw,
      candidates: r.candidates,
      screened: r.discarded,
      validation: validated.validations.map((v) => ({
        ...(v.titleJa ? { titleJa: v.titleJa } : {}),
        ok: v.result.ok,
        ...(v.result.ok ? {} : { reasons: v.result.reasons }),
      })),
      paths: validated.paths,
      log,
      usage: r.usage,
      ...(previousRuns.length > 0 ? { previousRuns: [...previousRuns] } : {}),
    };
    if (found) break;
  }
  if (!rec) throw new Error("実行されませんでした");
  mkdirSync(dirs.recordings, { recursive: true });
  writeFileSync(path, `${JSON.stringify(rec, null, 2)}\n`);
  console.log(`記録しました: eval/recordings/attacker.${profileId}.json`);
  return rec;
}

export async function runCompareLive(caseId: string, profileId: string): Promise<CompareRecording> {
  const k = loadKnowledge();
  const txt = join(dirs.cache, `${caseId}.txt`);
  if (!existsSync(txt))
    throw new Error(`記事の原文がありません: eval/.cache/${caseId}.txt（pnpm eval --live で取得）`);
  const text = readFileSync(txt, "utf8");
  const caseRec = JSON.parse(
    readFileSync(join(dirs.recordings, `${caseId}.with-knowledge.json`), "utf8"),
  ) as { output: unknown };
  const theCase = Case.parse(caseRec.output);
  const profile = loadProfile(join(repoRoot, "examples", `${profileId}.json`));
  const verdict = evaluate(theCase, profile, { knowledge: k, graph: buildGraph(profile, k.roles) });
  console.log(`知見なしの対策一覧（${caseId}）…`);
  const r = await listGenericMitigations(text, { attack: k.attack, title: theCase.title });
  const classified = compareGenericMitigations(r.items, verdict, k.labels);
  console.log(
    `  ${r.counts.total} 件：効く ${classified.counts.effective}、効かない ${classified.counts.ineffective}、経路の外 ${classified.counts.outside}、対応づけ不能 ${classified.counts.unmapped}`,
  );
  const rec: CompareRecording = {
    caseId,
    profileId,
    model: r.model,
    recordedAt: new Date().toISOString(),
    attackVersion: k.attack.version,
    note: "実際の出力の記録。知見ファイル（ラベル・型紙・ルール表）を渡さない Claude に、記事を読んで対策を緩和策 ID つきで列挙させたもの。ID の実在だけ確認済み。効く／効かない／経路の外の振り分けは engine の classifyMitigations（再生時は現在の判定で振り分け直す）。リクエストヘッダは保存していない",
    items: r.items,
    raw: r.raw,
    counts: r.counts,
    classified,
  };
  mkdirSync(dirs.recordings, { recursive: true });
  writeFileSync(compareRecordingPath(caseId), `${JSON.stringify(rec, null, 2)}\n`);
  console.log(`記録しました: eval/recordings/compare.${caseId}.json`);
  return rec;
}

/** 記録を現在の知識で検証し直して採点する（API キー不要） */
export function scoreAttacker(profileId: string) {
  const path = attackerRecordingPath(profileId);
  if (!existsSync(path)) return undefined;
  const rec = AttackerRecordingSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const k = loadKnowledge();
  const profile = loadProfile(join(repoRoot, "examples", `${profileId}.json`));
  const graph = buildGraph(profile, k.roles);
  // 記録の候補も再生前に安全検査・スキーマ検証をやり直し、engine の 4 点検証に通す（改ざんされた記録を通さない）
  const { candidates, screened } = screenRecording(rec, profileBannedTerms(profile));
  const validated = validateCandidates(candidates, graph, profile, k);
  const leaked = leakedTerms(profile, rec.input.rendered);
  return {
    profileId,
    model: rec.model,
    recordedAt: rec.recordedAt,
    attempts: rec.attempts,
    found: foundPlanted(validated.paths),
    adopted: validated.paths.length,
    discarded: screened.length + validated.discarded.length,
    discardedBySafety: screened.length,
    discardedByValidation: validated.discarded.length,
    leakedTerms: leaked,
    candidates: candidates.length + screened.length,
  };
}

export function scoreCompare(caseId: string, profileId: string) {
  const path = compareRecordingPath(caseId);
  if (!existsSync(path)) return undefined;
  const rec = CompareRecordingSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const k = loadKnowledge();
  const caseRec = JSON.parse(
    readFileSync(join(dirs.recordings, `${caseId}.with-knowledge.json`), "utf8"),
  ) as { output: unknown };
  const theCase = Case.parse(caseRec.output);
  const profile = loadProfile(join(repoRoot, "examples", `${profileId}.json`));
  const verdict = evaluate(theCase, profile, { knowledge: k, graph: buildGraph(profile, k.roles) });
  const c = compareGenericMitigations(toGenericMitigations(rec.items), verdict, k.labels);
  return { caseId, model: rec.model, recordedAt: rec.recordedAt, ...c.counts };
}

async function main() {
  const opts = parseOptions(process.argv.slice(2));
  if (opts.live) await runAttackerLive(opts.profileId, opts.runs);
  if (opts.compareLive) await runCompareLive(opts.caseId, opts.profileId);

  const attacker = scoreAttacker(opts.profileId);
  const compare = scoreCompare(opts.caseId, opts.profileId);
  if (!attacker)
    console.log(`下見の記録がありません: eval/recordings/attacker.${opts.profileId}.json`);
  else
    console.log(
      `AI攻撃者（${opts.profileId}）：仕込んだ経路 ${attacker.found ? "発見" : "未発見"}、採用 ${attacker.adopted} 本、破棄 ${attacker.discarded} 本（安全検査 ${attacker.discardedBySafety}、4 点検証 ${attacker.discardedByValidation}）、実行 ${attacker.attempts} 回、固有名詞の漏れ ${attacker.leakedTerms.length} 件`,
    );
  if (!compare) console.log(`比較の記録がありません: eval/recordings/compare.${opts.caseId}.json`);
  else
    console.log(
      `知見なし比較（${opts.caseId}）：${compare.total} 件 → 効く ${compare.effective}、効かない ${compare.ineffective}、経路の外 ${compare.outside}、対応づけ不能 ${compare.unmapped}`,
    );

  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
  mkdirSync(dirs.results, { recursive: true });
  writeFileSync(
    join(dirs.results, `attacker-${stamp}.json`),
    `${JSON.stringify({ recordedAt: now.toISOString(), attacker: attacker ?? null, compare: compare ?? null }, null, 2)}\n`,
  );
  const notes = [
    attacker
      ? `AI攻撃者：仕込んだ経路 ${attacker.found ? "発見" : "未発見"}（採用 ${attacker.adopted}・破棄 ${attacker.discarded}・実行 ${attacker.attempts} 回）`
      : "AI攻撃者：記録なし",
    compare
      ? `知見なし比較：効く ${compare.effective}・効かない ${compare.ineffective}・経路の外 ${compare.outside}・不能 ${compare.unmapped}`
      : "",
    process.env.EVAL_NOTE ?? "",
  ].filter(Boolean);
  const line = `| ${now.toISOString().slice(0, 16).replace("T", " ")} | - | - | ${(attacker ? 1 : 0) + (compare ? 1 : 0)} | ${notes.join("、")} |\n`;
  appendFileSync(join(root, "RESULTS.md"), line);
  console.log(`記録しました: eval/results/attacker-${stamp}.json, eval/RESULTS.md`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exit(1);
  });
}
