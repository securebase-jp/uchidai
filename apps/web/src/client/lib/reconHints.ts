/**
 * 外部確認の結果のうち、画面が後で使う分だけをこのブラウザの localStorage に残す。
 * - 5 問の初期値（「外部から推定」の印つき）：カルテがまだ無いときに、最初の5問の画面で使う
 * - カルテとの矛盾：反映したカルテの id と一緒に持ち、担当者画面の矛盾の欄に出す
 * 結果の全文（ホスト名の一覧など）は保存しない。サーバには送らない
 */
import { z } from "zod";
import type { AnswerHints } from "./reconApi.ts";
import type { Contradiction } from "./types.ts";

const KEY = "uchidai.recon.v1";
const DOMAIN_KEY = "uchidai.recon.domain";

const Saved = z.object({
  domain: z.string().min(1),
  fixture: z.boolean(),
  checkedAt: z.string(),
  answersHints: z.object({
    answers: z.object({
      hosting: z.object({
        mail: z.enum(["onprem", "cloud", "provider", "unknown"]).optional(),
        web: z.enum(["onprem", "cloud", "provider", "unknown"]).optional(),
      }),
      remoteAccess: z
        .array(z.enum(["vpn", "rdp", "vendor_remote", "cloud_only", "unknown"]))
        .optional(),
    }),
    inferred: z.array(z.enum(["hosting.mail", "hosting.web", "remoteAccess"])),
    reasonsJa: z.record(z.string(), z.string()),
  }),
  contradictions: z
    .object({
      profileId: z.string(),
      appliedAt: z.string(),
      items: z.array(
        z.object({
          assetId: z.string(),
          messageJa: z.string(),
          external: z.string(),
          registered: z.string(),
        }),
      ),
    })
    .optional(),
});
export type ReconHints = z.infer<typeof Saved> & { answersHints: AnswerHints };

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

/** 保存された JSON を読む。壊れていれば undefined */
export function parseReconHints(raw: string | null): ReconHints | undefined {
  if (!raw) return undefined;
  const parsed = safe<unknown>(() => JSON.parse(raw), undefined);
  const ok = Saved.safeParse(parsed);
  return ok.success ? (ok.data as ReconHints) : undefined;
}

export const reconHints = {
  load: (): ReconHints | undefined =>
    safe(() => parseReconHints(localStorage.getItem(KEY)), undefined),
  save: (h: ReconHints) => safe(() => localStorage.setItem(KEY, JSON.stringify(h)), undefined),
  /** 反映した矛盾を、カルテの id と一緒に残す */
  saveContradictions: (profileId: string, items: Contradiction[], appliedAt: string) => {
    const current = reconHints.load();
    if (!current) return;
    reconHints.save({ ...current, contradictions: { profileId, appliedAt, items } });
  },
  clear: () => safe(() => localStorage.removeItem(KEY), undefined),
  domain: (): string => safe(() => localStorage.getItem(DOMAIN_KEY) ?? "", ""),
  setDomain: (d: string) => safe(() => localStorage.setItem(DOMAIN_KEY, d), undefined),
};
