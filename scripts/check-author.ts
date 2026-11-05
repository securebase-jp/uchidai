/**
 * コミットの作者・コミッターが、許可した名前とメールだけかを検査する。
 * 本名や個人のメールアドレスが、コミットの履歴から公開されるのを防ぐ。
 *
 *   node scripts/check-author.ts                  これから作るコミットの作者（git の設定）を検査（pre-commit 用）
 *   node scripts/check-author.ts --range A..B      範囲内のコミットを検査（PR の CI 用）
 *   node scripts/check-author.ts --all             全履歴を検査（main への push の CI 用）
 *
 * 許可するのは、名前が ALLOWED_NAMES のどれか、かつメールが GitHub の noreply アドレスのものだけ。
 * 違反したときは、コミットの識別子と欄の名前だけを出す。値そのもの（本名やメール）は、
 * CI のログに残さないため出力しない。
 */
import { execFileSync } from "node:child_process";

const ALLOWED_NAMES = new Set(["ab3xy", "dependabot[bot]", "GitHub"]);
const NOREPLY_SUFFIX = "@users.noreply.github.com";
const GITHUB_NOREPLY = "noreply@github.com";

function emailAllowed(email: string): boolean {
  return email === GITHUB_NOREPLY || email.endsWith(NOREPLY_SUFFIX);
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" });
}

type Problem = { where: string; field: string };

function check(where: string, name: string, email: string, label: string): Problem[] {
  const problems: Problem[] = [];
  if (!ALLOWED_NAMES.has(name)) problems.push({ where, field: `${label}の名前` });
  if (!emailAllowed(email)) problems.push({ where, field: `${label}のメール` });
  return problems;
}

function parseIdent(ident: string): { name: string; email: string } {
  // 例："ab3xy <12345+user@users.noreply.github.com> 1699999999 +0900"
  const m = /^(.*) <(.*)> \d+ [+-]\d{4}$/.exec(ident.trim());
  return { name: m?.[1] ?? "", email: m?.[2] ?? "" };
}

const args = process.argv.slice(2);
const problems: Problem[] = [];

if (args[0] === "--range" || args[0] === "--all") {
  const revs = args[0] === "--all" ? ["--all"] : [args[1] ?? ""];
  if (args[0] === "--range" && !args[1]) {
    console.error("--range には A..B の形で範囲を渡してください");
    process.exit(2);
  }
  const out = git(["log", "--format=%h%x09%an%x09%ae%x09%cn%x09%ce", ...revs]);
  for (const line of out.split("\n").filter(Boolean)) {
    const [hash, an, ae, cn, ce] = line.split("\t");
    problems.push(...check(`コミット ${hash}`, an ?? "", ae ?? "", "作者"));
    problems.push(...check(`コミット ${hash}`, cn ?? "", ce ?? "", "コミッター"));
  }
} else {
  const author = parseIdent(git(["var", "GIT_AUTHOR_IDENT"]));
  const committer = parseIdent(git(["var", "GIT_COMMITTER_IDENT"]));
  problems.push(...check("git の設定", author.name, author.email, "作者"));
  problems.push(...check("git の設定", committer.name, committer.email, "コミッター"));
}

if (problems.length > 0) {
  console.error("許可していない名前かメールが、コミットの作者情報に含まれています。");
  for (const p of problems.slice(0, 20)) console.error(`  - ${p.where}：${p.field}`);
  if (problems.length > 20) console.error(`  ほか ${problems.length - 20} 件`);
  console.error(
    "git config user.name ab3xy と、GitHub の noreply アドレスを user.email に設定してください。",
  );
  process.exit(1);
}
console.log("コミットの作者情報: 問題なし");
