/**
 * 外部確認の API（所有確認 → DNS・証明書の公開ログの参照 → カルテへの反映）。
 * - POST /token   トークンを発行し、DNS に追加する TXT レコードと手順を返す（メモリ ＋ .data/recon-tokens.json）
 * - POST /verify  保存したトークンで所有確認。通れば VerifiedDomain をメモリに 24 時間保持する
 * - POST /run     所有確認済みのドメインだけ外部確認を実行（未確認は 403）。profile を渡せば反映後のカルテと矛盾も返す
 * - POST /apply   直前の結果（メモリ）を、後から渡したカルテに反映する
 * - GET  /status  所有確認の状態と最後の結果
 *
 * 安全：実際の DNS・crt.sh に問い合わせるのは、このサーバで verifyOwnership が通ったドメインだけ。
 * recon() 自身も VerifiedDomain（verifyOwnership だけが作る）を要求するので、二重に守られている。
 * 架空のドメイン demo-seiko.example は記録した応答（fixture）を再生し、実ネットワークには出ない。
 * 公開 URL 経由（remote-guard）では /api/recon/* はすべて拒否される。
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CompanyProfile } from "@uchidai/engine";
import {
  applyAssetHints,
  type CtLogSource,
  type DnsResolver,
  FileCache,
  findContradictions,
  fixtureSources,
  generateVerificationToken,
  InvalidDomainError,
  loadDemoFixture,
  mergeAnswers,
  NodeDnsResolver,
  normalizeDomain,
  OWNERSHIP_MAX_AGE_MS,
  OwnershipNotVerifiedError,
  type ReconFixture,
  type ReconResult,
  recon,
  reconToAnswers,
  reconToAssetHints,
  type VerifiedDomain,
  verificationInstructionsJa,
  verificationRecord,
  verifyOwnership,
} from "@uchidai/recon";
import { Hono } from "hono";
import { z } from "zod";
import {
  type AppliedView,
  CT_UNAVAILABLE_JA,
  DomainInput,
  DomainRequest,
  FIXTURE_DOMAIN,
  type RunView,
  type StatusView,
  TokenRequest,
  type TokenView,
  type VerifyView,
} from "../../shared/recon.ts";
import { dataDir } from "../data-dir.ts";
import { ClientError } from "../errors.ts";

export const defaultTokenFile = join(dataDir, "recon-tokens.json");
/**
 * トークンの有効期間（7 日。SEC-014）。期限が切れたトークンは所有確認に使えず、次の発行で作り直す。
 * 以前の版の記録も createdAt を持つ（無い記録は読み込みで捨てる）ので、同じ規則で期限を見る。
 * 7 日より前に発行したトークンは安全側に倒して失効扱いにする（DNS に残っていても、発行し直して TXT を置き直してもらう）
 */
export const TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export function tokenExpiresAt(createdAt: string): string {
  return new Date(Date.parse(createdAt) + TOKEN_MAX_AGE_MS).toISOString();
}
export function isTokenExpired(createdAt: string, now: Date): boolean {
  const age = now.getTime() - Date.parse(createdAt);
  return Number.isNaN(age) || age > TOKEN_MAX_AGE_MS;
}

type StoredToken = { domain: string; token: string; createdAt: string };
const StoredTokens = z.object({
  tokens: z.array(
    z.object({
      domain: z.string().min(1),
      token: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
      createdAt: z.string(),
    }),
  ),
});

/** ファイルのトークン一覧を読む。無い・壊れている・形が違うときは空（次の発行で書き直す） */
function readTokens(file: string): StoredToken[] {
  if (!existsSync(file)) return [];
  try {
    const parsed = StoredTokens.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data.tokens : [];
  } catch {
    return [];
  }
}

/** トークン（ファイルにも保存）、所有確認の結果（メモリだけ）、最後の実行結果（メモリだけ） */
export class ReconStore {
  private readonly tokens = new Map<string, StoredToken>();
  private readonly verified = new Map<string, VerifiedDomain>();
  private readonly lastRun = new Map<string, RunView>();
  private readonly file: string | undefined;

  constructor(file?: string) {
    this.file = file;
    if (file) for (const t of readTokens(file)) this.tokens.set(t.domain, t);
  }

  /**
   * ファイルに書く。別のプロセス（別ポートで動く dev サーバなど）が同じファイルに書いたドメインは残し、
   * 自分の持つドメインだけ上書きする。一時ファイル名はプロセスごとに分け、rename で置き換える
   */
  private persist(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const merged = new Map<string, StoredToken>();
    for (const t of readTokens(this.file)) merged.set(t.domain, t);
    for (const t of this.tokens.values()) merged.set(t.domain, t);
    const tmp = `${this.file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify({ tokens: [...merged.values()] }, null, 2), "utf8");
    renameSync(tmp, this.file);
  }

  getToken(domain: string): StoredToken | undefined {
    return this.tokens.get(domain);
  }
  setToken(t: StoredToken): void {
    this.tokens.set(t.domain, t);
    this.persist();
  }

  getVerified(domain: string, now: Date): VerifiedDomain | undefined {
    const v = this.verified.get(domain);
    if (!v) return undefined;
    if (now.getTime() - Date.parse(v.verifiedAt) > OWNERSHIP_MAX_AGE_MS) {
      this.verified.delete(domain);
      return undefined;
    }
    return v;
  }
  setVerified(v: VerifiedDomain): void {
    this.verified.set(v.domain, v);
  }
  clearVerified(domain: string): void {
    this.verified.delete(domain);
  }

  getLastRun(domain: string): RunView | undefined {
    return this.lastRun.get(domain);
  }
  setLastRun(domain: string, run: RunView): void {
    this.lastRun.set(domain, run);
  }
}

export type LiveSources = { resolver: DnsResolver; ct?: CtLogSource };

export type ReconDeps = {
  store?: ReconStore;
  now?: () => Date;
  /**
   * 実際の参照先（所有確認済みのドメインにだけ使う）。既定は Node の DNS と crt.sh（ディスクキャッシュ）。
   * テストでは偽物を差し込み、呼ばれないことを確かめる
   */
  live?: () => LiveSources;
};

const liveFromEnv = (): LiveSources => ({ resolver: new NodeDnsResolver() });

function expiresAt(verifiedAt: string): string {
  return new Date(Date.parse(verifiedAt) + OWNERSHIP_MAX_AGE_MS).toISOString();
}

/** 入力のドメインを正規化する（不正なら 400 と日本語の理由） */
function domainOf(input: string): string {
  try {
    return normalizeDomain(input);
  } catch (e) {
    if (e instanceof InvalidDomainError) throw new ClientError(400, e.message);
    throw e;
  }
}

function recordView(domain: string, token: string) {
  return { name: domain, type: "TXT" as const, value: verificationRecord(token) };
}

/**
 * findContradictions → applyAssetHints → mergeAnswers の順（属性は上書きされるので矛盾を先に拾う）。
 * applyAssetHints には公開ログの名前も渡し、廃止済みの資産に「外部に残っているか」、現役の資産に証明書の期限を付ける
 * （engine が判定のたびに矛盾を出せるよう、カルテ自体に根拠 external で残す）
 */
export function applyToProfile(result: ReconResult, profile: CompanyProfile): AppliedView {
  const contradictions = findContradictions(result, profile);
  const hints = reconToAssetHints(result);
  let next: CompanyProfile = {
    ...applyAssetHints(profile, hints, result),
    domain: result.domain,
    domainVerified: true,
  };
  const view: AppliedView = { profile: next, contradictions };
  if (profile.answers) {
    const merged = mergeAnswers(profile.answers, reconToAnswers(result));
    next = { ...next, answers: merged.answers };
    view.profile = next;
    view.answers = { merged: merged.answers, applied: merged.applied };
  }
  return view;
}

export function reconRoutes(deps: ReconDeps = {}): Hono {
  const store = deps.store ?? new ReconStore(defaultTokenFile);
  const now = deps.now ?? (() => new Date());
  const live = deps.live ?? liveFromEnv;
  let fixtureCache: ReconFixture | undefined;
  const fixture = (): ReconFixture => {
    fixtureCache ??= loadDemoFixture();
    return fixtureCache;
  };
  const isFixture = (domain: string) => domain === FIXTURE_DOMAIN;
  const routes = new Hono();

  routes.post("/token", async (c) => {
    const body = TokenRequest.parse(await c.req.json());
    const domain = domainOf(body.domain);
    const existing = store.getToken(domain);
    let stored: StoredToken;
    if (isFixture(domain)) {
      // 架空のドメイン：記録に入っている TXT と同じトークンを返す（DNS の設定は要らない）
      stored = {
        domain,
        token: fixture().verificationToken ?? "",
        createdAt: fixture().recordedAt,
      };
    } else if (existing && !body.renew && !isTokenExpired(existing.createdAt, now())) {
      stored = existing;
    } else {
      stored = { domain, token: generateVerificationToken(), createdAt: now().toISOString() };
      store.setToken(stored);
      store.clearVerified(domain);
    }
    const view: TokenView = {
      domain,
      fixture: isFixture(domain),
      token: stored.token,
      createdAt: stored.createdAt,
      ...(isFixture(domain) ? {} : { expiresAt: tokenExpiresAt(stored.createdAt) }),
      record: recordView(domain, stored.token),
      instructionsJa: isFixture(domain)
        ? [
            "架空のドメインです。記録した応答（fixture）を再生するので、DNS の設定は要りません。",
            "実際のドメインで試すときは、同じ手順で発行したトークンを TXT レコードに設定します。",
          ]
        : verificationInstructionsJa(domain, stored.token),
    };
    return c.json(view);
  });

  routes.post("/verify", async (c) => {
    const body = DomainRequest.parse(await c.req.json());
    const domain = domainOf(body.domain);
    const fx = isFixture(domain);
    const stored = fx ? undefined : store.getToken(domain);
    const token = fx ? (fixture().verificationToken ?? "") : stored?.token;
    if (!token) {
      throw new ClientError(
        400,
        "このドメインのトークンがまだ発行されていません。先に手順 1 でトークンを発行してください",
      );
    }
    if (stored && isTokenExpired(stored.createdAt, now())) {
      store.clearVerified(domain);
      throw new ClientError(
        400,
        "このドメインのトークンは期限（7 日）が切れています。手順 1 でトークンを発行し直し、新しい値を TXT レコードに設定してください",
      );
    }
    const resolver = fx ? fixtureSources(fixture()).resolver : live().resolver;
    const check = await verifyOwnership(domain, token, { resolver, now });
    if (!check.ok) {
      store.clearVerified(domain);
      const view: VerifyView = {
        ok: false,
        domain,
        fixture: fx,
        reasonJa: check.reasonJa,
        txtRecords: check.txtRecords,
      };
      return c.json(view);
    }
    store.setVerified(check.verified);
    const view: VerifyView = {
      ok: true,
      domain,
      fixture: fx,
      verifiedAt: check.verified.verifiedAt,
      expiresAt: expiresAt(check.verified.verifiedAt),
    };
    return c.json(view);
  });

  const RunRequest = z.object({ domain: DomainInput, profile: CompanyProfile.optional() });
  routes.post("/run", async (c) => {
    const body = RunRequest.parse(await c.req.json());
    const domain = domainOf(body.domain);
    const fx = isFixture(domain);
    const ownership = store.getVerified(domain, now());
    if (!ownership) {
      throw new ClientError(
        403,
        "所有確認が済んでいないドメインには外部確認を実行しません。手順 2 の「所有を確認する」を先に通してください（確認は 24 時間で失効します）",
      );
    }
    let result: ReconResult;
    try {
      if (fx) {
        const { resolver, ct } = fixtureSources(fixture());
        result = await recon(domain, { ownership, resolver, ct, now });
      } else {
        const sources = live();
        result = await recon(domain, {
          ownership,
          resolver: sources.resolver,
          ...(sources.ct ? { ct: sources.ct } : { cache: new FileCache() }),
          now,
        });
      }
    } catch (e) {
      if (e instanceof OwnershipNotVerifiedError) {
        store.clearVerified(domain);
        throw new ClientError(403, `${e.message}。手順 2 からやり直してください`);
      }
      throw e;
    }
    const view: RunView = {
      domain,
      fixture: fx,
      result,
      answersHints: reconToAnswers(result),
      assetHints: reconToAssetHints(result),
      ...(result.sources.ct === "unavailable" ? { ctUnavailableJa: CT_UNAVAILABLE_JA } : {}),
      ...(body.profile ? { applied: applyToProfile(result, body.profile) } : {}),
    };
    // サーバに会社カルテを残さない：記憶するのは外部確認の結果だけ（反映後のカルテは応答にだけ含める）
    const { applied: _applied, ...remembered } = view;
    store.setLastRun(domain, remembered);
    return c.json(view);
  });

  const ApplyRequest = z.object({ domain: DomainInput, profile: CompanyProfile });
  routes.post("/apply", async (c) => {
    const body = ApplyRequest.parse(await c.req.json());
    const domain = domainOf(body.domain);
    const last = store.getLastRun(domain);
    if (!last) {
      throw new ClientError(
        404,
        "このドメインの外部確認の結果がサーバにありません。手順 3 の「外部確認を実行する」をもう一度押してください",
      );
    }
    return c.json(applyToProfile(last.result, body.profile));
  });

  routes.get("/status", (c) => {
    const domain = domainOf(DomainInput.parse(c.req.query("domain") ?? ""));
    const fx = isFixture(domain);
    const token = fx
      ? { createdAt: fixture().recordedAt, token: fixture().verificationToken ?? "" }
      : store.getToken(domain);
    const verified = store.getVerified(domain, now());
    const last = store.getLastRun(domain);
    const view: StatusView = {
      domain,
      fixture: fx,
      token: token
        ? {
            createdAt: token.createdAt,
            ...(fx
              ? {}
              : {
                  expiresAt: tokenExpiresAt(token.createdAt),
                  expired: isTokenExpired(token.createdAt, now()),
                }),
            record: recordView(domain, token.token),
          }
        : null,
      verified: verified
        ? { verifiedAt: verified.verifiedAt, expiresAt: expiresAt(verified.verifiedAt) }
        : null,
      lastRun: last
        ? {
            checkedAt: last.result.checkedAt,
            findings: last.result.findings.length,
            ctUnavailable: last.result.sources.ct === "unavailable",
          }
        : null,
    };
    return c.json(view);
  });

  return routes;
}
