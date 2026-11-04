/**
 * @uchidai/recon：外部確認
 *
 * 使い方（S3 の API から）：
 *   const token = generateVerificationToken();          // 担当者に TXT レコードを設定してもらう
 *   const check = await verifyOwnership(domain, token);  // DNS の TXT を確認
 *   if (!check.ok) return check.reasonJa;
 *   const result = await recon(domain, { ownership: check.verified });
 *   const answers = reconToAnswers(result);              // 5 問の初期値（外部から推定）
 *   const hints = reconToAssetHints(result);             // 資産の属性（根拠 external）
 *   const contradictions = findContradictions(result, profile);
 *
 * デモ・テストでは fixture を使う：
 *   const { resolver, ct } = fixtureSources(loadDemoFixture());
 *   verifyOwnership(domain, token, { resolver }) → recon(domain, { ownership, resolver, ct })
 */
export * from "./answers.ts";
export * from "./cache.ts";
export * from "./certspotter.ts";
export * from "./contradictions.ts";
export * from "./crtsh.ts";
export * from "./dns-node.ts";
export * from "./fallback-ct.ts";
export * from "./fixture.ts";
export * from "./ownership.ts";
export * from "./patterns.ts";
export type { FetchLike } from "./proxy.ts";
export * from "./recon.ts";
export * from "./safe-fetch.ts";
export * from "./sources.ts";
export * from "./types.ts";
