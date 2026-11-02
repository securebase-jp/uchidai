/**
 * 画面の状態：知識、会社カルテ、事例、対策、判定結果。
 * カルテは localStorage だけに保存する。判定は必ず API（engine）に頼む。
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
import type { AnswerInput } from "../../shared/api.ts";
import {
  ApiError,
  api,
  type Evaluation,
  type KnowledgeView,
  type RecordedCaseMeta,
} from "../lib/api.ts";
import { storage } from "../lib/storage.ts";
import type { Case, CompanyProfile } from "../lib/types.ts";

export type ProfileSource = "example" | "answers" | "saved";
export type CaseMeta = {
  label: string;
  sourceJa: string;
  recorded?: RecordedCaseMeta;
  sourceUrl?: string;
};

export type AppState = {
  knowledge: KnowledgeView | undefined;
  profile: CompanyProfile | undefined;
  profileSource: ProfileSource | undefined;
  theCase: Case | undefined;
  caseMeta: CaseMeta | undefined;
  measureIds: string[];
  answers: AnswerInput[];
  evaluation: Evaluation | undefined;
  busy: boolean;
  error: string | undefined;
  loadExample(id: string): Promise<void>;
  setProfile(p: CompanyProfile, source: ProfileSource): void;
  clearProfile(): void;
  setCase(c: Case, meta: CaseMeta): void;
  loadRecorded(caseId: string): Promise<void>;
  toggleMeasure(id: string): void;
  clearMeasures(): void;
  addAnswer(a: AnswerInput): void;
  clearAnswers(): void;
  setError(e: string | undefined): void;
};

const Ctx = createContext<AppState | undefined>(undefined);

export const DEFAULT_CASE_ID = "ipa-case-1";

export function AppProvider({ children }: { children: ReactNode }) {
  const [knowledge, setKnowledge] = useState<KnowledgeView>();
  const [profile, setProfileState] = useState<CompanyProfile | undefined>(() =>
    storage.loadProfile(),
  );
  const [profileSource, setProfileSource] = useState<ProfileSource | undefined>(() =>
    storage.loadProfile() ? "saved" : undefined,
  );
  const [theCase, setCaseState] = useState<Case>();
  const [caseMeta, setCaseMeta] = useState<CaseMeta>();
  const [measureIds, setMeasureIds] = useState<string[]>([]);
  const [answers, setAnswers] = useState<AnswerInput[]>([]);
  const [evaluation, setEvaluation] = useState<Evaluation>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const seq = useRef(0);

  const fail = useCallback(
    (e: unknown) =>
      setError(e instanceof ApiError || e instanceof Error ? e.message : "通信に失敗しました"),
    [],
  );

  useEffect(() => {
    api.knowledge().then(setKnowledge).catch(fail);
  }, [fail]);

  const setProfile = useCallback((p: CompanyProfile, source: ProfileSource) => {
    setProfileState(p);
    setProfileSource(source);
    storage.saveProfile(p);
    setMeasureIds([]);
    setAnswers([]);
  }, []);
  const clearProfile = useCallback(() => {
    storage.clearProfile();
    setProfileState(undefined);
    setProfileSource(undefined);
    setEvaluation(undefined);
    setMeasureIds([]);
    setAnswers([]);
  }, []);
  const loadExample = useCallback(
    async (id: string) => {
      try {
        const { profile: p } = await api.example(id);
        setProfile(p, "example");
      } catch (e) {
        fail(e);
      }
    },
    [setProfile, fail],
  );
  const setCase = useCallback((c: Case, meta: CaseMeta) => {
    setCaseState(c);
    setCaseMeta(meta);
    setMeasureIds([]);
  }, []);
  const loadRecorded = useCallback(
    async (caseId: string) => {
      try {
        const { case: c, meta } = await api.recorded(caseId);
        setCase(c, {
          label: c.title,
          sourceJa: `IPA 事例集の読解結果（記録 ${caseId}）`,
          recorded: meta,
        });
      } catch (e) {
        fail(e);
      }
    },
    [setCase, fail],
  );

  // URL の ?profile=demo-seiko で架空企業のカルテを読む
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("profile");
    if (id) void loadExample(id);
  }, [loadExample]);

  // 事例が無ければ記録済みの事例 1 を使う（デモとキー無しの動作確認用）
  useEffect(() => {
    if (!theCase) void loadRecorded(DEFAULT_CASE_ID);
  }, [theCase, loadRecorded]);

  // 判定：カルテ・事例・対策・回答のどれかが変わるたびに API へ
  useEffect(() => {
    if (!profile || !theCase) return;
    const my = ++seq.current;
    setBusy(true);
    api
      .evaluate({ case: theCase, profile, measureIds, answers })
      .then((ev) => {
        if (my !== seq.current) return;
        setEvaluation(ev);
        setError(undefined);
      })
      .catch((e) => my === seq.current && fail(e))
      .finally(() => my === seq.current && setBusy(false));
  }, [profile, theCase, measureIds, answers, fail]);

  const toggleMeasure = useCallback(
    (id: string) =>
      setMeasureIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])),
    [],
  );
  const clearMeasures = useCallback(() => setMeasureIds([]), []);
  // 同じ資産・同じ緩和策への回答は、後から来たものが前のものを置き換える（二重適用しない）
  const addAnswer = useCallback(
    (a: AnswerInput) =>
      setAnswers((xs) => [
        ...xs.filter((x) => !(x.assetId === a.assetId && x.mitigation === a.mitigation)),
        a,
      ]),
    [],
  );
  const clearAnswers = useCallback(() => setAnswers([]), []);

  const value = useMemo<AppState>(
    () => ({
      knowledge,
      profile,
      profileSource,
      theCase,
      caseMeta,
      measureIds,
      answers,
      evaluation,
      busy,
      error,
      loadExample,
      setProfile,
      clearProfile,
      setCase,
      loadRecorded,
      toggleMeasure,
      clearMeasures,
      addAnswer,
      clearAnswers,
      setError,
    }),
    [
      knowledge,
      profile,
      profileSource,
      theCase,
      caseMeta,
      measureIds,
      answers,
      evaluation,
      busy,
      error,
      loadExample,
      setProfile,
      clearProfile,
      setCase,
      loadRecorded,
      toggleMeasure,
      clearMeasures,
      addAnswer,
      clearAnswers,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("AppProvider の外で useApp が呼ばれた");
  return v;
}
