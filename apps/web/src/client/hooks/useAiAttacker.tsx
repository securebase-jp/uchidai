/**
 * AI攻撃者と知見なし比較の状態。
 * - 下見の候補は Claude（または記録）から一度だけ受け取り、対策ボタン・回答で判定結果が変わるたびに
 *   プログラム（/api/attacker/validate）で検証し直す。Claude は呼び直さない
 * - 知見なしの対策一覧も一度だけ受け取り、判定結果が変わるたびに振り分け直す
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiError } from "../lib/api.ts";
import {
  type AiPathCandidate,
  attackerApi,
  type Comparison,
  type DiscardedCandidate,
  type GenericMitigationItem,
  type ReconMeta,
} from "../lib/attackerApi.ts";
import type { AttackPath, Verdict } from "../lib/types.ts";
import { useApp } from "./useApp.tsx";

export type AiAttackerState = {
  /** 下見を実行（または記録を再生）したか */
  ran: boolean;
  busy: boolean;
  error: string | undefined;
  recorded: boolean | undefined;
  meta: ReconMeta | undefined;
  candidates: AiPathCandidate[];
  /** 現在のカルテで検証を通った経路（source: ai） */
  paths: AttackPath[];
  discarded: DiscardedCandidate[];
  log: string[];
  run(): Promise<void>;
  clear(): void;
  comparison: Comparison | undefined;
  compareBusy: boolean;
  compareError: string | undefined;
  compareRecorded: boolean | undefined;
  compareMeta: { model?: string; recordedAt?: string; note?: string } | undefined;
  runCompare(): Promise<void>;
};

const Ctx = createContext<AiAttackerState | undefined>(undefined);

const message = (e: unknown) =>
  e instanceof ApiError || e instanceof Error ? e.message : "通信に失敗しました";

export function AiAttackerProvider({ children }: { children: ReactNode }) {
  const app = useApp();
  const { profile, evaluation, theCase, caseMeta } = app;
  const [ran, setRan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [recorded, setRecorded] = useState<boolean>();
  const [meta, setMeta] = useState<ReconMeta>();
  const [candidates, setCandidates] = useState<AiPathCandidate[]>([]);
  const [paths, setPaths] = useState<AttackPath[]>([]);
  const [discarded, setDiscarded] = useState<DiscardedCandidate[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [comparison, setComparison] = useState<Comparison>();
  const [items, setItems] = useState<GenericMitigationItem[]>();
  const [compareBusy, setCompareBusy] = useState(false);
  const [compareError, setCompareError] = useState<string>();
  const [compareRecorded, setCompareRecorded] = useState<boolean>();
  const [compareMeta, setCompareMeta] = useState<AiAttackerState["compareMeta"]>();
  const seq = useRef(0);
  const cseq = useRef(0);
  /** 候補を最後に検証したカルテ（同じカルテなら検証し直さない） */
  const validatedFor = useRef<unknown>(undefined);

  const clear = useCallback(() => {
    seq.current++;
    setRan(false);
    setBusy(false);
    setError(undefined);
    setRecorded(undefined);
    setMeta(undefined);
    setCandidates([]);
    setPaths([]);
    setDiscarded([]);
    setLog([]);
  }, []);

  // カルテが入れ替わったら下見も比較も消す（別の会社の経路を引きずらない）
  const profileId = profile?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: カルテの ID が変わったときだけ消す
  useEffect(() => {
    clear();
    setComparison(undefined);
    setItems(undefined);
    setCompareError(undefined);
    setCompareRecorded(undefined);
    setCompareMeta(undefined);
  }, [profileId, clear]);

  const run = useCallback(async () => {
    const p = evaluation?.profile ?? profile;
    if (!p) return;
    const my = ++seq.current;
    setBusy(true);
    setError(undefined);
    try {
      const r = await attackerApi.recon(p);
      if (my !== seq.current) return;
      validatedFor.current = p;
      setRan(true);
      setRecorded(r.recorded);
      setMeta(r.meta);
      setCandidates(r.candidates);
      setPaths(r.paths);
      setDiscarded(r.discarded);
      setLog(r.log);
    } catch (e) {
      if (my === seq.current) setError(message(e));
    } finally {
      if (my === seq.current) setBusy(false);
    }
  }, [evaluation?.profile, profile]);

  // 判定結果（対策・回答の適用後のカルテ）が変わったら、候補を検証し直す
  const evalProfile = evaluation?.profile;
  useEffect(() => {
    if (!evalProfile || candidates.length === 0) return;
    if (validatedFor.current === evalProfile) return;
    validatedFor.current = evalProfile;
    const my = seq.current;
    attackerApi
      .validate(evalProfile, candidates)
      .then((r) => {
        if (my !== seq.current) return;
        setPaths(r.paths);
        setDiscarded((prev) => [...prev.filter((d) => d.stage !== "validation"), ...r.discarded]);
        const open = r.paths.filter((x) => x.reachedCore).length;
        setLog((prev) => [
          ...prev.filter((l) => !l.startsWith("検証し直し")),
          `検証し直し（対策・回答の適用後）：採用 ${r.paths.length} 本、うち中核に到達 ${open} 本`,
        ]);
      })
      .catch((e) => my === seq.current && setError(message(e)));
  }, [evalProfile, candidates]);

  const runCompare = useCallback(async () => {
    const verdict = evaluation?.verdict;
    if (!verdict || !theCase) return;
    const my = ++cseq.current;
    setCompareBusy(true);
    setCompareError(undefined);
    try {
      const r = await attackerApi.compare(
        caseMeta?.recorded
          ? { caseId: caseMeta.recorded.caseId, verdict }
          : { case: theCase, verdict },
      );
      if (my !== cseq.current) return;
      setComparison(r.comparison);
      setItems(r.items);
      setCompareRecorded(r.recorded);
      setCompareMeta(r.meta);
    } catch (e) {
      if (my === cseq.current) setCompareError(message(e));
    } finally {
      if (my === cseq.current) setCompareBusy(false);
    }
  }, [evaluation?.verdict, theCase, caseMeta]);

  // 判定結果が変わったら、取り寄せ済みの一覧を振り分け直す（Claude は呼ばない）
  const verdict = evaluation?.verdict;
  useEffect(() => {
    if (!verdict || !items) return;
    const my = cseq.current;
    attackerApi
      .compare({ verdict, items })
      .then((r) => my === cseq.current && setComparison(r.comparison))
      .catch((e) => my === cseq.current && setCompareError(message(e)));
  }, [verdict, items]);

  const value = useMemo<AiAttackerState>(
    () => ({
      ran,
      busy,
      error,
      recorded,
      meta,
      candidates,
      paths,
      discarded,
      log,
      run,
      clear,
      comparison,
      compareBusy,
      compareError,
      compareRecorded,
      compareMeta,
      runCompare,
    }),
    [
      ran,
      busy,
      error,
      recorded,
      meta,
      candidates,
      paths,
      discarded,
      log,
      run,
      clear,
      comparison,
      compareBusy,
      compareError,
      compareRecorded,
      compareMeta,
      runCompare,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAiAttacker(): AiAttackerState {
  const v = useContext(Ctx);
  if (!v) throw new Error("AiAttackerProvider の外で useAiAttacker が呼ばれた");
  return v;
}

/** 判定結果に AI が見つけた経路を足す（結論・時間軸は変えない。描画と攻撃者ログが source: ai として扱う） */
export function withAiPaths(verdict: Verdict, aiPaths: AttackPath[]): Verdict {
  if (aiPaths.length === 0) return verdict;
  return { ...verdict, paths: [...verdict.paths.filter((p) => p.source !== "ai"), ...aiPaths] };
}
