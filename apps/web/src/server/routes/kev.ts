/**
 * 悪用確認済み脆弱性（CISA KEV）の API。
 * - GET  /status   カタログの状態（版、公開日、件数、取得日時、古いか）
 * - POST /refresh  CISA の JSON を取得して .data/kev.json に保存（24 時間はキャッシュ。force で取り直す）。
 *                  取得に失敗したらキャッシュのまま「取得できなかった」を返す
 * - POST /match    カルテの資産（製品名と版）を KEV と範囲表に突き合わせ、反映後のカルテと矛盾を返す
 *
 * 安全：ネットワークに出るのは KEV_URL（CISA の JSON）だけ。取得の直前に URL を検査し、リダイレクトは追わない。
 * カルテはサーバに残さない（応答にだけ含める）。公開 URL 経由（remote-guard）では /api/kev/* はすべて拒否される。
 * Claude は使わない。製品名と版はこのサーバの中だけで扱う
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  applyKev,
  CompanyProfile,
  KevCatalog,
  type KevProductsFile,
  loadKevProducts,
  matchKev,
} from "@uchidai/engine";
import { resolveFetch } from "@uchidai/llm";
import { Hono } from "hono";
import { z } from "zod";
import {
  KEV_URL,
  type KevMatchView,
  type KevRefreshView,
  type KevStatusView,
  RefreshRequest,
} from "../../shared/kev.ts";
import { dataDir } from "../data-dir.ts";
import { ClientError, publicMessage } from "../errors.ts";

export const defaultKevFile = join(dataDir, "kev.json");
export const KEV_TTL_MS = 24 * 60 * 60 * 1000;
/** JSON の大きさの上限（2026 年時点で約 2MB。桁違いに大きければ壊れているか別物） */
const MAX_BYTES = 32 * 1024 * 1024;

const Stored = z.object({ fetchedAt: z.string(), catalog: KevCatalog });
export type StoredCatalog = z.infer<typeof Stored>;

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class ForbiddenKevUrlError extends Error {
  constructor(url: string) {
    super(`KEV の取得先は CISA の JSON に固定されている: ${url}`);
    this.name = "ForbiddenKevUrlError";
  }
}

/** 取得先が KEV_URL と完全に一致するときだけ fetch する。リダイレクトは追わない */
export async function fetchKevCatalog(
  url: string,
  options: { fetch?: FetchLike; timeoutMs?: number } = {},
): Promise<KevCatalog> {
  if (url !== KEV_URL) throw new ForbiddenKevUrlError(url);
  const base = resolveFetch(options.fetch);
  const res = await base(url, {
    method: "GET",
    redirect: "error",
    headers: { accept: "application/json", "user-agent": "uchidai-kev/0.0 (+catalog sync)" },
    signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
  });
  if (!res.ok) throw new Error(`CISA から ${res.status} が返りました`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error("KEV カタログが想定より大きすぎます");
  return KevCatalog.parse(JSON.parse(text));
}

/** カタログの置き場（メモリ ＋ .data/kev.json） */
export class KevStore {
  private stored: StoredCatalog | undefined;
  private readonly file: string | undefined;
  lastErrorJa: string | undefined;

  constructor(file?: string) {
    this.file = file;
    if (file && existsSync(file)) {
      try {
        const parsed = Stored.safeParse(JSON.parse(readFileSync(file, "utf8")));
        if (parsed.success) this.stored = parsed.data;
      } catch {
        // 壊れたキャッシュは無いものとして扱う（次の取得で書き直す）
      }
    }
  }

  get(): StoredCatalog | undefined {
    return this.stored;
  }

  set(stored: StoredCatalog): void {
    this.stored = stored;
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify(stored), "utf8");
    renameSync(tmp, this.file);
  }
}

export type KevDeps = {
  store?: KevStore;
  fetch?: FetchLike;
  now?: () => Date;
  ttlMs?: number;
  /** 対応表（テストでは差し替え可） */
  table?: () => KevProductsFile;
};

export function kevRoutes(deps: KevDeps = {}): Hono {
  const store = deps.store ?? new KevStore(defaultKevFile);
  const now = deps.now ?? (() => new Date());
  const ttl = deps.ttlMs ?? KEV_TTL_MS;
  let tableCache: KevProductsFile | undefined;
  const table = (): KevProductsFile => {
    tableCache ??= deps.table ? deps.table() : loadKevProducts();
    return tableCache;
  };
  const isStale = (s: StoredCatalog | undefined) =>
    !s || now().getTime() - Date.parse(s.fetchedAt) > ttl;

  const status = (): KevStatusView => {
    const s = store.get();
    const t = table();
    return {
      available: s !== undefined,
      ...(s
        ? {
            catalogVersion: s.catalog.catalogVersion,
            dateReleased: s.catalog.dateReleased,
            count: s.catalog.count,
            fetchedAt: s.fetchedAt,
          }
        : {}),
      stale: isStale(s),
      ...(store.lastErrorJa ? { lastErrorJa: store.lastErrorJa } : {}),
      sourceUrl: KEV_URL,
      table: { checkedAt: t.checkedAt, products: t.products.length },
    };
  };

  const routes = new Hono();

  routes.get("/status", (c) => c.json(status()));

  routes.post("/refresh", async (c) => {
    const body = RefreshRequest.parse(await c.req.json().catch(() => ({})));
    const current = store.get();
    if (current && !body.force && !isStale(current)) {
      const view: KevRefreshView = { ok: true, fetched: false, status: status() };
      return c.json(view);
    }
    try {
      const fetchOpts = deps.fetch ? { fetch: deps.fetch } : {};
      const catalog = await fetchKevCatalog(KEV_URL, fetchOpts);
      store.set({ fetchedAt: now().toISOString(), catalog });
      store.lastErrorJa = undefined;
      const view: KevRefreshView = { ok: true, fetched: true, status: status() };
      return c.json(view);
    } catch (e) {
      const reason = publicMessage(e, "取得に失敗しました");
      store.lastErrorJa = `${now().toISOString().slice(0, 16).replace("T", " ")} に取得できませんでした（${reason}）`;
      const view: KevRefreshView = {
        ok: false,
        fetched: false,
        errorJa: current
          ? `CISA から KEV カタログを取得できませんでした（${reason}）。手元のキャッシュ（カタログ版 ${current.catalog.catalogVersion}）で続けます`
          : `CISA から KEV カタログを取得できませんでした（${reason}）。キャッシュも無いため、突き合わせはできません`,
        status: status(),
      };
      return c.json(view);
    }
  });

  const MatchRequest = z.object({
    profile: CompanyProfile,
    assetId: z.string().max(100),
    /** 画面で入力中の製品名と版（カルテの値より優先し、反映後のカルテにも書く） */
    product: z.string().max(200).optional(),
    version: z.string().max(100).optional(),
  });
  routes.post("/match", async (c) => {
    const body = MatchRequest.parse(await c.req.json());
    const s = store.get();
    if (!s) {
      throw new ClientError(
        404,
        "KEV カタログがまだ取り込まれていません。「取り込む」を押して CISA から取得してください",
      );
    }
    const asset = body.profile.assets.find((a) => a.id === body.assetId);
    if (!asset) throw new ClientError(404, `構成要素 ${body.assetId} がカルテにありません`);
    const product = body.product !== undefined ? body.product.trim() : asset.product;
    const version = body.version !== undefined ? body.version.trim() : asset.version;
    // 入力中の製品名と版をカルテに書いてから突き合わせる（反映後のカルテと一致させる）
    const profile: CompanyProfile = structuredClone(body.profile);
    const target = profile.assets.find((a) => a.id === body.assetId);
    if (target) {
      if (product) target.product = product;
      else delete target.product;
      if (version) target.version = version;
      else delete target.version;
    }
    const match = matchKev(
      { ...(product ? { product } : {}), ...(version ? { version } : {}) },
      s.catalog,
      table(),
    );
    const applied = applyKev(profile, body.assetId, match, now().toISOString());
    const view: KevMatchView = { match, applied, status: status() };
    return c.json(view);
  });

  return routes;
}
