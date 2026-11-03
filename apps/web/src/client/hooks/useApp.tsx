/**
 * 画面の状態：知識、会社カルテ、事例、対策、判定結果。
 * カルテは localStorage だけに保存する。判定は必ず API（engine）に頼む。
 * 会社は「自社のカルテ（このブラウザに保存）」と「架空の会社（examples/）」から上部バーで選ぶ。
 * 架空の会社を読んでも自社の保存は消さない（選んだ架空の会社の ID だけを別に覚える）。
 * 初回は会社も事例も空のままにし、架空の会社や既定の事例を黙って読み込まない（URL の ?profile= とデモモードは別）
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
  type ExampleSummary,
  type KnowledgeView,
  type RecordedCaseMeta,
} from "../lib/api.ts";
import { shouldLoadDefaultCase } from "../lib/default-case.ts";
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
  /** このブラウザに保存してある自社のカルテ（架空の会社を見ている間も保持する） */
  ownProfile: CompanyProfile | undefined;
  /** 架空の会社の一覧（GET /api/examples） */
  examples: ExampleSummary[];
  /** 上部バーの会社の選択：自社のカルテに戻す、または架空の会社を読む */
  selectCompany(choice: { kind: "own" } | { kind: "example"; id: string }): Promise<void>;
  theCase: Case | undefined;
  caseMeta: CaseMeta | undefined;
  /** 事例を担当者が選んだ（記事を読ませた、または記録済みの事例を選んだ）か。false はデモ・録画の URL が読んだ既定の事例 1 */
  caseChosen: boolean;
  measureIds: string[];
  answers: AnswerInput[];
  evaluation: Evaluation | undefined;
  busy: boolean;
  error: string | undefined;
  loadExample(id: string): Promise<void>;
  setProfile(p: CompanyProfile, source: ProfileSource): void;
  clearProfile(): void;
  /** カルテを初期値に戻す：架空の会社は examples/ から読み直し、自社は 5 問の回答から作り直す（登録した詳細は消える） */
  resetProfile(): Promise<void>;
  setCase(c: Case, meta: CaseMeta): void;
  /** 記録済みの事例を読む。chosen: false は既定の事例（担当者が選んだのではない） */
  loadRecorded(caseId: string, opts?: { chosen?: boolean }): Promise<void>;
  toggleMeasure(id: string): void;
  clearMeasures(): void;
  addAnswer(a: AnswerInput): void;
  clearAnswers(): void;
  setError(e: string | undefined): void;
};

const Ctx = createContext<AppState | undefined>(undefined);

export const DEFAULT_CASE_ID = "ipa-case-1";

/** URL の ?profile=（架空企業のカルテ）。あるときは保存済みのカルテで先に判定しない（二重の判定と巻き戻しを避ける） */
const urlProfileId = () => new URLSearchParams(location.search).get("profile");

export function AppProvider({ children }: { children: ReactNode }) {
  const [knowledge, setKnowledge] = useState<KnowledgeView>();
  const [examples, setExamples] = useState<ExampleSummary[]>([]);
  // 自社のカルテは保存から復元する。前回、架空の会社を選んでいたときはその会社を読み直す（下の effect）
  const [ownProfile, setOwnProfile] = useState<CompanyProfile | undefined>(() =>
    urlProfileId() ? undefined : storage.loadProfile(),
  );
  const rememberedExample = useMemo(
    () => (urlProfileId() ? undefined : storage.loadExampleId()),
    [],
  );
  const [profile, setProfileState] = useState<CompanyProfile | undefined>(() =>
    rememberedExample ? undefined : ownProfile,
  );
  const [profileSource, setProfileSource] = useState<ProfileSource | undefined>(() =>
    profile ? "saved" : undefined,
  );
  // 担当者が選んだ事例はこのブラウザに保存してある（再読み込みで既定の事例 1 に戻らない）。?profile= のデモでは使わない
  const saved = useMemo(() => (urlProfileId() ? undefined : storage.loadCase()), []);
  const [theCase, setCaseState] = useState<Case | undefined>(saved?.case);
  const [caseMeta, setCaseMeta] = useState<CaseMeta | undefined>(saved?.meta);
  const [caseChosen, setCaseChosen] = useState(saved !== undefined);
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
    // 一覧が読めなくても画面は動く（会社のチップに架空の会社が並ばないだけ）
    api
      .examples()
      .then((r) => setExamples(r.items))
      .catch(() => {});
  }, [fail]);

  // 自社のカルテ（5 問の回答、カルテ画面の保存）は localStorage に保存する。架空の会社は保存しない
  const setProfile = useCallback((p: CompanyProfile, source: ProfileSource) => {
    setProfileState(p);
    setProfileSource(source);
    if (source !== "example") {
      storage.saveProfile(p);
      storage.clearExampleId();
      setOwnProfile(p);
    }
    setMeasureIds([]);
    setAnswers([]);
  }, []);
  const clearProfile = useCallback(() => {
    storage.clearProfile();
    storage.clearExampleId();
    setOwnProfile(undefined);
    setProfileState(undefined);
    setProfileSource(undefined);
    setEvaluation(undefined);
    setMeasureIds([]);
    setAnswers([]);
  }, []);
  const resetProfile = useCallback(async () => {
    const p = profile;
    if (!p) return;
    try {
      if (profileSource === "example") {
        const { profile: fresh } = await api.example(p.id);
        setProfile(fresh, "example");
        return;
      }
      if (!p.answers) return;
      const { profile: fresh } = await api.fromAnswers(p.answers, p.companyName);
      setProfile(fresh, profileSource ?? "saved");
    } catch (e) {
      fail(e);
    }
  }, [profile, profileSource, setProfile, fail]);
  const loadExample = useCallback(
    async (id: string) => {
      try {
        const { profile: p } = await api.example(id);
        setProfile(p, "example");
        // 次に開いたときも同じ架空の会社にする。URL の ?profile=（デモ）では覚えない
        if (!urlProfileId()) storage.saveExampleId(id);
      } catch (e) {
        fail(e);
      }
    },
    [setProfile, fail],
  );
  const selectCompany = useCallback(
    async (choice: { kind: "own" } | { kind: "example"; id: string }) => {
      if (choice.kind === "example") return loadExample(choice.id);
      // 保存した自社のカルテが無ければ、最初の5問へ進んで作る
      if (!ownProfile) {
        location.hash = "/questions";
        return;
      }
      storage.clearExampleId();
      setProfileState(ownProfile);
      setProfileSource("saved");
      setMeasureIds([]);
      setAnswers([]);
    },
    [loadExample, ownProfile],
  );
  const setCase = useCallback((c: Case, meta: CaseMeta, chosen = true) => {
    setCaseState(c);
    setCaseMeta(meta);
    setCaseChosen(chosen);
    setMeasureIds([]);
    if (chosen) {
      const { recorded, ...rest } = meta;
      storage.saveCase({
        case: c,
        meta: { ...rest, ...(recorded ? { recorded: { caseId: recorded.caseId } } : {}) },
      });
    } else storage.clearCase();
  }, []);
  const loadRecorded = useCallback(
    async (caseId: string, opts?: { chosen?: boolean }) => {
      try {
        const { case: c, meta } = await api.recorded(caseId);
        setCase(
          c,
          {
            label: c.title,
            sourceJa: `IPA 事例集の読解結果（記録 ${caseId}）`,
            recorded: meta,
          },
          opts?.chosen ?? true,
        );
      } catch (e) {
        fail(e);
      }
    },
    [setCase, fail],
  );

  // URL の ?profile=demo-seiko で架空企業のカルテを読む。無ければ、前回上部バーで選んだ架空の会社を読み直す
  useEffect(() => {
    const id = urlProfileId() ?? rememberedExample;
    if (id) void loadExample(id);
  }, [loadExample, rememberedExample]);

  // 事例が無いときに記録済みの事例 1 を黙って読むのは、デモ・録画の URL のときだけ（台本が事例 1 に依存する）。
  // 通常は事例を空のまま「事例を選んでください」を出す。読んだ事例は担当者が選んだものではない
  useEffect(() => {
    if (!theCase && shouldLoadDefaultCase(location.search))
      void loadRecorded(DEFAULT_CASE_ID, { chosen: false });
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
      ownProfile,
      examples,
      selectCompany,
      theCase,
      caseMeta,
      caseChosen,
      measureIds,
      answers,
      evaluation,
      busy,
      error,
      loadExample,
      setProfile,
      clearProfile,
      resetProfile,
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
      ownProfile,
      examples,
      selectCompany,
      theCase,
      caseMeta,
      caseChosen,
      measureIds,
      answers,
      evaluation,
      busy,
      error,
      loadExample,
      setProfile,
      clearProfile,
      resetProfile,
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
