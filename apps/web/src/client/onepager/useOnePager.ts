/**
 * 一枚のデータを集める。
 * - URL に d=（内容を載せた共有リンク）があれば、その文字列だけから一枚を復元する（API も、カルテも使わない）
 * - 無ければ、URL の指定（profile / case / measures）か画面の状態を POST /api/onepager に渡す。判定と計算はサーバ（engine）
 * - デモモード（?demo=1）で条件が記録と同じときだけ、記録した一枚（Claude の言い換えつき）を即座に使い、API を呼ばない
 *   （demo/onepager-recording.ts。録画で言い換えを待つ空白を出さず、毎回同じ文にする）
 */
import { useEffect, useRef, useState } from "react";
import { recordedOnePagerForDemo } from "../demo/onepager-recording.ts";
import { isDemoMode } from "../demo/params.ts";
import { useApp } from "../hooks/useApp.tsx";
import { ApiError, api, type OnePagerResponse } from "../lib/api.ts";
import { decodeShare, type SharePayload } from "../lib/onepager-share.ts";
import type { Case, CompanyProfile } from "../lib/types.ts";
import { buildOnePagerHash, type OnePagerParams, withRewrite } from "./params.ts";

export type OnePagerState =
  | { status: "loading" }
  /** 会社と事例は決まっているが、まだ作っていない（ボタンを押すまで、API にも AI にも何も送らない） */
  | { status: "idle" }
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
      /** 文の書き方（Claude／テンプレート）だけを切り替えて、同じ一枚を取り直している間 true（紙は前のまま出しておく） */
      writing: boolean;
      /** デモモードで、記録した一枚を使った（API も Claude も呼んでいない） */
      recorded?: { recordedAt: string; model: string };
    }
  /** 共有リンク（d=）から復元した一枚 */
  | { status: "shared"; payload: SharePayload };

/** 記録から作った状態どうしが同じか（同じなら描き直さない） */
const same = (a: OnePagerState, b: OnePagerState) =>
  a.status === "ready" &&
  b.status === "ready" &&
  a.data === b.data &&
  a.idShareHash === b.idShareHash;

export function useOnePager(params: OnePagerParams): {
  state: OnePagerState;
  /** 一枚を作る。ai: true は Claude に「何が起きるか」の文を書かせる、false は AI を使わない */
  generate(ai: boolean): void;
  /** いま使う文の書き方（true は Claude）。押された選択が先で、押す前は URL の指定 */
  rewrite: boolean;
  /** デモモードで、押せば記録した一枚を出せる（API キーが無くても「AI で一枚を作る」を押せる） */
  recordedAvailable: boolean;
} {
  const app = useApp();
  // 作ってよいと押された時点の入力（会社・事例・対策・回答）。これが変わったら、また押すまで作らない
  const [requested, setRequested] = useState<{ base: unknown[]; rewrite: boolean }>();

  const measureIds = params.measures ?? app.measureIds;
  const measuresKey = measureIds.join(",");
  const answersKey = JSON.stringify(app.answers);
  const profileId =
    params.profile ?? (app.profileSource === "example" ? app.profile?.id : undefined);
  const caseId = params.case ?? app.caseMeta?.recorded?.caseId;
  const appProfile = params.profile ? undefined : app.profile;
  const appCase = params.case ? undefined : app.theCase;
  const shared = params.d;

  // 文の書き方だけが変わったときは紙を消さずに取り直す（そのほかが前回と同じかを覚えておく）
  const lastBase = useRef<unknown[]>([]);
  const base = [shared, params.profile, params.case, measuresKey, answersKey, appProfile, appCase];
  // デモモードで条件が記録と同じなら、記録した一枚（Claude の言い換えつき）を使える（デモでなければ常に undefined）
  const recorded = recordedOnePagerForDemo({
    profileId: params.profile,
    caseId: params.case,
    measureIds,
    answers: app.answers,
    shared,
    rewrite: params.rewrite,
  });
  // 録画（デモモード）と generate=1 のときだけ、押さずに作る。ふだんは押されるまで何も送らない。
  // ただしデモで記録を使えるときは、ふだんと同じく「AI で一枚を作る」が押されてから出す（録画では絵コンテのカーソルが押す）
  const auto = (isDemoMode() && !recorded) || params.generate === true;
  const enabled =
    auto ||
    (requested !== undefined &&
      requested.base.length === base.length &&
      requested.base.every((v, i) => v === base[i]));
  // 押された選択（AI か、使わないか）を、URL の rewrite より先に使う。URL が追いつく前に別の書き方で送らないため
  const rewrite = !auto && requested && enabled ? requested.rewrite : params.rewrite;

  // 押されたら（デモで記録を使えて、Claude の文を選んだとき）、記録した一枚を API を呼ばずに即座に出す
  const recordedState = (): OnePagerState | undefined =>
    recorded && enabled && rewrite && profileId && caseId
      ? {
          status: "ready",
          data: recorded.data,
          entryUnknown: recorded.entryUnknown,
          writing: false,
          idShareHash: buildOnePagerHash({
            profile: profileId,
            case: caseId,
            measures: measureIds,
          }),
          recorded: { recordedAt: recorded.recordedAt, model: recorded.model },
        }
      : undefined;
  const [state, setState] = useState<OnePagerState>(() => recordedState() ?? { status: "loading" });

  // biome-ignore lint/correctness/useExhaustiveDependencies: 判定に影響する値だけで再取得する
  useEffect(() => {
    let alive = true;
    const onlyTextChanged =
      base.length === lastBase.current.length && base.every((v, i) => v === lastBase.current[i]);
    lastBase.current = base;
    const fromRecording = recordedState();
    if (fromRecording) {
      setState((prev) =>
        prev.status === "ready" && prev.recorded && same(prev, fromRecording)
          ? prev
          : fromRecording,
      );
      return;
    }
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
        if (!enabled) {
          setState({ status: "idle" });
          return;
        }
        setState((prev) =>
          onlyTextChanged && prev.status === "ready"
            ? { ...prev, writing: true }
            : { status: "loading" },
        );
        // 複数の報を読んだ事例のときだけ、各報の読解も渡す（前の報から変わったことを、サーバがプログラムで比べる）
        const reports = params.case ? undefined : app.caseMeta?.series?.reports;
        const data = await api.onepager({
          case: theCase,
          profile,
          measureIds,
          answers: app.answers,
          rewrite,
          ...(reports ? { reports } : {}),
        });
        if (!alive) return;
        setState({
          status: "ready",
          data,
          entryUnknown: theCase.clarity === "unknown",
          writing: false,
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
    enabled,
    params.profile,
    params.case,
    rewrite,
    measuresKey,
    answersKey,
    appProfile,
    appCase,
  ]);

  const generate = (ai: boolean) => {
    setRequested({ base, rewrite: ai });
    // Claude（既定）は rewrite を書かず、テンプレートは rewrite=0（共有・再読み込みでも同じ設定になる）
    const next = withRewrite(location.hash, ai);
    if (next !== location.hash) location.hash = next;
  };

  return { state, generate, rewrite, recordedAvailable: recorded !== undefined };
}
