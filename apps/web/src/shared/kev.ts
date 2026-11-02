/**
 * 悪用確認済み脆弱性（CISA KEV）の API（/api/kev）の契約。画面とサーバの両方が読む（値として engine を import しない）。
 */
import type { CompanyProfile, Contradiction, KevMatch } from "@uchidai/engine";
import { z } from "zod";

/** 取得先は CISA の JSON 1 つに固定する（他の URL へは出ない） */
export const KEV_URL =
  "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

export const RefreshRequest = z.object({ force: z.boolean().optional() });

export type KevStatusView = {
  /** カタログが手元にある（取得済み、またはキャッシュ） */
  available: boolean;
  catalogVersion?: string;
  dateReleased?: string;
  count?: number;
  fetchedAt?: string;
  /** 取得から 24 時間を過ぎている */
  stale: boolean;
  /** 直近の取得の失敗（キャッシュで動いているとき） */
  lastErrorJa?: string;
  sourceUrl: string;
  /** 対応表（knowledge/kev/products.yaml）の確認日と製品数 */
  table: { checkedAt: string; products: number };
};

export type KevRefreshView = {
  /** 取得に成功した（キャッシュが新しくて取得しなかったときも true） */
  ok: boolean;
  /** 実際に CISA から取得した */
  fetched: boolean;
  errorJa?: string;
  status: KevStatusView;
};

export type KevMatchView = {
  match: KevMatch;
  applied: {
    profile: CompanyProfile;
    contradictions: Contradiction[];
    changed: string[];
  };
  status: KevStatusView;
};
