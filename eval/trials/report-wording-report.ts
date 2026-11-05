/**
 * 報告義務の文言・一枚の文の仕上げの再試験の集計（C5）：eval/.cache/trials/<id>/ の結果から、機械的に調べられる点を出す。
 * 「報告が不要」と読める文、記事の被害額・未遂・漏えいした情報の種類の読み、対象外の案内、不自然な動詞の残りを見る。記事の本文は読まない
 *   node --disable-warning=ExperimentalWarning eval/trials/report-wording-report.ts <id>...
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cache = join(dirname(fileURLToPath(import.meta.url)), "..", ".cache", "trials");
const get = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const NEGATION = /報告(も|は|が)?(必要(あり|な)(ません|い)|不要|いりません)/;
const AWKWARD =
  /(区画|システム|ホームページ|ストレージ|口座|サーバ)が(持ち出される|起きる|盗まれる)/;
const total = { n: 0, negation: 0, awkward: 0, claude: 0, template: 0 };
for (const id of process.argv.slice(2)) {
  const read = get(join(cache, id, "read.json"));
  const op = get(join(cache, id, "demo-seiko.onepager.json"));
  const op5 = get(join(cache, id, "from-answers.onepager.json"));
  if (!read?.case) continue;
  total.n += 1;
  const lines: string[] = [
    ...(op?.onePager?.whatHappensJa ?? []),
    ...(op5?.onePager?.whatHappensJa ?? []),
  ];
  const neg = lines.filter((l) => NEGATION.test(l));
  const awk = lines.filter((l) => AWKWARD.test(l));
  total.negation += neg.length > 0 ? 1 : 0;
  total.awkward += awk.length > 0 ? 1 : 0;
  op?.text?.source === "claude" ? total.claude++ : total.template++;
  const c = read.case;
  console.log(
    [
      id,
      `${c.damageType}`,
      `victim=${c.victim ?? "self"}`,
      `leak=${(c.leakedData ?? []).join("+") || "-"}`,
      `loss=${c.reportedLossJpy ?? "-"}`,
      `averted=${c.averted ? "yes" : "-"}`,
      `result=${op?.onePager?.result ?? "?"}`,
      `text=${op?.text?.source ?? "-"}`,
      neg.length ? `不要と読める=${neg.length}` : "",
      awk.length ? `不自然=${awk.length}` : "",
    ].join("\t"),
  );
}
console.log(JSON.stringify(total));
