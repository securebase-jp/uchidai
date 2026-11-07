/**
 * まとめ依頼の試験の補助。POST /api/requests/batch は expectText（プレビューで見せた本文）が必須なので、
 * app.request に渡された作成の要求に expectText が無ければ、先に同じ内容でプレビューを取って本文を渡す。
 * プレビューが 200 でなければ、その応答をそのまま返す（入力の誤りは、プレビューと作成で同じ応答になる）。
 * 確認なしの作成そのものを試したいときは、ヘッダ x-no-auto-expect を付ける。
 */
import type { Hono } from "hono";

export function autoExpect<T extends Hono>(app: T): T {
  const orig = app.request.bind(app) as (
    input: string,
    init?: RequestInit,
  ) => Response | Promise<Response>;
  const patched = (input: string, init?: RequestInit): Response | Promise<Response> => {
    const raw = new Headers(init?.headers).has("x-no-auto-expect");
    if (
      !raw &&
      input === "/api/requests/batch" &&
      init?.method === "POST" &&
      typeof init.body === "string"
    ) {
      let body: unknown;
      try {
        body = JSON.parse(init.body);
      } catch {
        return orig(input, init);
      }
      if (body && typeof body === "object" && !("expectText" in body)) {
        return (async () => {
          const pv = await orig("/api/requests/batch/preview", init);
          if (pv.status !== 200) return pv;
          const { text } = (await pv.json()) as { text: string };
          return orig(input, { ...init, body: JSON.stringify({ ...body, expectText: text }) });
        })();
      }
    }
    return orig(input, init);
  };
  (app as unknown as { request: typeof patched }).request = patched;
  return app;
}
