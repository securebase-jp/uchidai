/**
 * 一枚のデータを集める。
 * - URL に d=（内容を載せた共有リンク）があれば、その文字列だけから一枚を復元する（API も、カルテも使わない）
 * - 無ければ、URL の指定（profile / case / measures）か画面の状態を POST /api/onepager に渡す。判定と計算はサーバ（engine）
 */
import { useEffect, useState } from "react";
import { useApp } from "../hooks/useApp.tsx";
import { ApiError, api, type OnePagerResponse } from "../lib/api.ts";
import { decodeShare, type SharePayload } from "../lib/onepager-share.ts";
import type { Case, CompanyProfile } from "../lib/types.ts";
import { buildOnePagerHash, type OnePagerParams } from "./params.ts";

export type OnePagerState =
  | { status: "loading" }
  /** 会社か事例が無い。無いほうの一覧を、会社→事例の順に出す */
  | { status: "missing"; needs: { profile: boolean; case: boolean } }
  | { status: "error"; messageJa: string }
  /** API で作った一枚。idShareHash は ID で指す形の共有リンク（架空の会社の記録のときだけ作れる） */
  | {
      status: "ready";
      data: OnePagerResponse;
      idShareHash: string | undefined;
      /** 記事に入口が書かれていない事例（型紙の入口候補で判定した一枚） */
      entryUnknown: boolean;
    }
  /** 共有リンク（d=）から復元した一枚 */
  | { status: "shared"; payload: SharePayload };

export function useOnePager(params: OnePagerParams): OnePagerState {
  const app = useApp();
  const [state, setState] = useState<OnePagerState>({ status: "loading" });

  const measureIds = params.measures ?? app.measureIds;
  const measuresKey = measureIds.join(",");
  const answersKey = JSON.stringify(app.answers);
  const profileId =
    params.profile ?? (app.profileSource === "example" ? app.profile?.id : undefined);
  const caseId = params.case ?? app.caseMeta?.recorded?.caseId;
  const appProfile = params.profile ? undefined : app.profile;
  const appCase = params.case ? undefined : app.theCase;
  const shared = params.d;

  // biome-ignore lint/correctness/useExhaustiveDependencies: 判定に影響する値だけで再取得する
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (shared) {
          setState({ status: "loading" });
          const r = await decodeShare(shared);
          if (!alive) return;
          setState(
            r.ok
              ? { status: "shared", payload: r.payload }
              : { status: "error", messageJa: `共有リンクを開けませんでした。${r.reasonJa}` },
          );
          return;
        }
        let profile: CompanyProfile | undefined = appProfile;
        if (params.profile) profile = (await api.example(params.profile)).profile;
        let theCase: Case | undefined = appCase;
        if (params.case) theCase = (await api.recorded(params.case)).case;
        if (!alive) return;
        if (!profile || !theCase) {
          setState({ status: "missing", needs: { profile: !profile, case: !theCase } });
          return;
        }
        setState({ status: "loading" });
        const data = await api.onepager({
          case: theCase,
          profile,
          measureIds,
          answers: app.answers,
          rewrite: params.rewrite,
        });
        if (!alive) return;
        setState({
          status: "ready",
          data,
          entryUnknown: theCase.clarity === "unknown",
          idShareHash:
            profileId && caseId
              ? buildOnePagerHash({ profile: profileId, case: caseId, measures: measureIds })
              : undefined,
        });
      } catch (e) {
        if (!alive) return;
        setState({
          status: "error",
          messageJa:
            e instanceof ApiError || e instanceof Error ? e.message : "一枚を作れませんでした",
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [
    shared,
    params.profile,
    params.case,
    params.rewrite,
    measuresKey,
    answersKey,
    appProfile,
    appCase,
  ]);

  return state;
}
