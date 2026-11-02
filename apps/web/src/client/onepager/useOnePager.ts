/**
 * 一枚のデータを集める：URL の指定（profile / case / measures）があればそれを、無ければ画面の状態を使い、
 * POST /api/onepager に渡す。判定と計算はサーバ（engine）。
 */
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../hooks/useApp.tsx";
import { ApiError, api, type OnePagerResponse } from "../lib/api.ts";
import type { Case, CompanyProfile } from "../lib/types.ts";
import { buildOnePagerHash, type OnePagerParams } from "./params.ts";

export type OnePagerState =
  | { status: "loading" }
  | { status: "missing"; reasonJa: string }
  | { status: "error"; messageJa: string }
  | { status: "ready"; data: OnePagerResponse; shareHash: string; shareable: boolean };

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: 判定に影響する値だけで再取得する
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let profile: CompanyProfile | undefined = appProfile;
        if (params.profile) profile = (await api.example(params.profile)).profile;
        let theCase: Case | undefined = appCase;
        if (params.case) theCase = (await api.recorded(params.case)).case;
        if (!alive) return;
        if (!profile) {
          setState({
            status: "missing",
            reasonJa:
              "会社カルテがありません。最初の5問に答えるか、架空の会社（デモ精工）を選んでください。",
          });
          return;
        }
        if (!theCase) {
          setState({
            status: "missing",
            reasonJa: "事例がありません。はじめにで事例を選んでください。",
          });
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
        const shareable = Boolean(profileId && caseId);
        setState({
          status: "ready",
          data,
          shareable,
          shareHash: buildOnePagerHash({ profile: profileId, case: caseId, measures: measureIds }),
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
  }, [params.profile, params.case, params.rewrite, measuresKey, answersKey, appProfile, appCase]);

  return useMemo(() => state, [state]);
}
