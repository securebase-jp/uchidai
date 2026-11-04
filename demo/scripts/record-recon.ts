/**
 * デモ場面 4 用：demo-sec.com を実際に外部確認し、その結果を demo/recordings/recon.demo-sec.json に記録する。
 * 画面（ReconReplay）はこの記録を再生する（実際のネットワークには出ない。毎回同じ映像になる）。
 *
 * 外に出るのは、demo-sec.com の DNS の公開レコードの参照だけ（サンドボックスの外で実行する）。
 * 証明書の公開ログは新しく問い合わせず、packages/recon/.cache にある Cert Spotter の応答（24 時間）だけを使う。
 * キャッシュが無い・切れているときは、何も実行せずに止まる（Cert Spotter は 1 時間 10 回の制限）。
 * 対象のホストには一切つながない。
 *
 * 実行：node --disable-warning=ExperimentalWarning demo/scripts/record-recon.ts
 * 手順と注意は demo/recon-recording.md
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isIPv4, isIPv6 } from "node:net";
import { join } from "node:path";
import { type ApplyChanges, applyChanges } from "../../apps/web/src/client/lib/reconView.ts";
import {
  defaultTokenFile,
  ReconStore,
  reconRoutes,
} from "../../apps/web/src/server/routes/recon.ts";
import type { AppliedView, RunView, VerifyView } from "../../apps/web/src/shared/recon.ts";
import {
  findRealIps,
  RECON_RECORDING_NOTE,
  RECON_RECORDING_VERSION,
  ReconRecording,
} from "../../apps/web/src/shared/reconRecording.ts";
import { CompanyProfile } from "../../packages/engine/src/index.ts";
import {
  CertSpotterSource,
  defaultCacheDir,
  FileCache,
  NodeDnsResolver,
  ReconResult,
} from "../../packages/recon/src/index.ts";
import { repoRoot } from "./lib.ts";

const DOMAIN = "demo-sec.com";
const PROFILE_PATH = join(repoRoot, "examples", "demo-seiko.json");
const OUT_PATH = join(repoRoot, "demo", "recordings", "recon.demo-sec.json");
const CACHE_KEY = `certspotter:${DOMAIN}`;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_PLACEHOLDER = "uchidai-verify=（記録では省略）";

function stop(message: string): never {
  console.error(`止めました：${message}`);
  process.exit(2);
}

/** キャッシュに Cert Spotter の応答があり、24 時間以内か。なければ止める（新しくは問い合わせない） */
function readCacheAge(now: Date): { storedAt: string; ageHours: number } {
  const digest = createHash("sha256").update(CACHE_KEY).digest("hex").slice(0, 32);
  let storedAt: string;
  try {
    const envelope = JSON.parse(readFileSync(join(defaultCacheDir, `${digest}.json`), "utf8")) as {
      storedAt?: string;
    };
    if (!envelope.storedAt) throw new Error("storedAt がありません");
    storedAt = envelope.storedAt;
  } catch {
    stop(
      `${CACHE_KEY} のキャッシュがありません。Cert Spotter は 1 時間 10 回までなので、新しくは問い合わせません。PM に報告してください`,
    );
  }
  const age = now.getTime() - Date.parse(storedAt);
  if (Number.isNaN(age) || age > CACHE_TTL_MS) {
    stop(
      `${CACHE_KEY} のキャッシュが切れています（取得 ${storedAt}）。新しくは問い合わせません。PM に報告してください`,
    );
  }
  return { storedAt, ageHours: Math.round((age / 3600000) * 10) / 10 };
}

/** 実際の IP アドレスを、文書用の予約範囲（203.0.113.0/24、IPv6 は 2001:db8::/32）に一貫して置き換える */
function makeIpMapper() {
  const v4 = new Map<string, string>();
  const v6 = new Map<string, string>();
  const isDoc4 = (ip: string) => /^(?:192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/.test(ip);
  const map = (token: string): string => {
    if (isIPv4(token)) {
      if (isDoc4(token)) return token;
      if (!v4.has(token)) {
        const n = 10 + v4.size;
        if (n > 250) throw new Error("置き換える IP が多すぎます");
        v4.set(token, `203.0.113.${n}`);
      }
      return v4.get(token) ?? token;
    }
    if (isIPv6(token)) {
      if (/^2001:db8(:|$)/i.test(token)) return token;
      if (!v6.has(token)) v6.set(token, `2001:db8::${(v6.size + 1).toString(16)}`);
      return v6.get(token) ?? token;
    }
    return token;
  };
  return {
    text(s: string): string {
      return s.replace(/[0-9A-Fa-f:.]{2,}/g, (tok) => map(tok));
    },
    count: () => ({ ipv4: v4.size, ipv6: v6.size }),
  };
}

async function post<T>(
  routes: ReturnType<typeof reconRoutes>,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await routes.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) stop(`${path} が ${res.status} を返しました：${json.error ?? "(理由なし)"}`);
  return json;
}

async function main() {
  const now = new Date();
  const cache = readCacheAge(now);
  console.log(
    `証明書の公開ログ：キャッシュを使う（取得 ${cache.storedAt}、${cache.ageHours} 時間前）`,
  );

  const store = new ReconStore(defaultTokenFile);
  if (!store.getToken(DOMAIN)) {
    stop(`${DOMAIN} の所有確認トークンが ${defaultTokenFile} にありません`);
  }

  // 公開ログへの新しい問い合わせは禁止：キャッシュに無ければ、ここで例外になり止まる
  const noNetwork = async (): Promise<Response> => {
    throw new Error("記録の実行では公開ログに新しく問い合わせない（キャッシュだけを使う）");
  };
  const ct = new CertSpotterSource({ cache: new FileCache(), fetch: noNetwork });
  const routes = reconRoutes({
    store,
    live: () => ({ resolver: new NodeDnsResolver(), ct }),
  });

  // 1. 所有確認（DNS の TXT）。24 時間で失効するので、記録の直前にやり直す
  const verify = await post<VerifyView>(routes, "/verify", { domain: DOMAIN });
  if (!verify.ok) stop(`所有確認が通りません：${verify.reasonJa}`);
  console.log(`所有確認 ✓（${verify.verifiedAt}）`);

  // 2. 外部確認（DNS の公開レコード＋キャッシュ済みの公開ログ）。カルテはデモ精工
  const profile = CompanyProfile.parse(JSON.parse(readFileSync(PROFILE_PATH, "utf8")));
  const run = await post<RunView>(routes, "/run", { domain: DOMAIN, profile });
  const result = run.result;
  if (result.sources.ct !== "live" || result.sources.ctProvider !== "certspotter") {
    stop(`証明書の公開ログを使えていません（sources.ct = ${result.sources.ct}）。記録しません`);
  }
  const applied: AppliedView | undefined = run.applied;
  if (!applied) stop("反映後のカルテと矛盾が返っていません");
  const changes: ApplyChanges = applyChanges(profile, applied);

  const labelOf = (id: string) => profile.assets.find((a) => a.id === id)?.label ?? id;
  const contradictions = applied.contradictions.map((c) => {
    const hostname = /ホスト名 ([a-z0-9.-]+) が/.exec(c.messageJa)?.[1] ?? "";
    return { ...c, assetLabel: labelOf(c.assetId), hostname };
  });

  // 3. 記録を組み立てる。実際に得た値は書き換えない。置き換えるのは IP とトークンだけ
  const { applied: _drop, ...runWithoutApplied } = run;
  const draft = {
    version: RECON_RECORDING_VERSION,
    domain: DOMAIN,
    recordedAt: now.toISOString(),
    note: RECON_RECORDING_NOTE,
    provenance: {
      dns: "live" as const,
      ct: { provider: "certspotter" as const, cachedAt: cache.storedAt, queriedNow: false },
      redactions: [
        "IP アドレス（文書用の予約範囲 203.0.113.0/24、2001:db8::/32 に置き換え）",
        "所有確認のトークン（TXT の値は省略）",
        "リクエストヘッダ（保存していない）",
      ],
      targetHostsAccessed: false as const,
    },
    run: runWithoutApplied,
    applied: {
      profile: {
        id: profile.id,
        companyName: profile.companyName,
        fictional: true as const,
        ...(profile.domain ? { domain: profile.domain } : {}),
      },
      contradictions,
      changes,
    },
  };
  const mapper = makeIpMapper();
  const sanitized = JSON.parse(mapper.text(JSON.stringify(draft))) as typeof draft;
  sanitized.run.result.ownership.record = TOKEN_PLACEHOLDER;

  // 4. 検証：形（recon の ReconResult と記録の schema）、IP の残り、トークンの残り
  ReconResult.parse(sanitized.run.result);
  const recording = ReconRecording.parse(sanitized);
  const text = `${JSON.stringify(recording, null, 2)}\n`;
  const leftovers = findRealIps(text);
  if (leftovers.length > 0) stop(`記録に実際の IP が残っています：${leftovers.join(", ")}`);
  const token = store.getToken(DOMAIN)?.token ?? "";
  if (token && text.includes(token)) stop("記録に所有確認のトークンが残っています");

  mkdirSync(join(repoRoot, "demo", "recordings"), { recursive: true });
  writeFileSync(OUT_PATH, text, "utf8");
  const counts = mapper.count();
  console.log(`書き出しました：${OUT_PATH}`);
  console.log(
    `  確認項目 ${result.findings.length} 件、ホスト名 ${result.hostnames.length} 件、矛盾 ${contradictions.length} 件、IP の置き換え IPv4 ${counts.ipv4} 件・IPv6 ${counts.ipv6} 件`,
  );
}

await main();
