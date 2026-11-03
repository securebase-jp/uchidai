/**
 * 既定の事例（記録済みの事例 1）を黙って読み込んでよいか。
 * デモ・録画の URL（?profile= がある、?demo=1、?autostart=1）のときだけ読み込む。台本が事例 1 に依存するため。
 * それ以外は、会社と同じく事例も空で始め、担当者に選んでもらう
 */
export function shouldLoadDefaultCase(search: string): boolean {
  const p = new URLSearchParams(search);
  return p.has("profile") || p.get("demo") === "1" || p.get("autostart") === "1";
}
