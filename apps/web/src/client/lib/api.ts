/** API クライアント。Claude API のキーはサーバにしかない */
import type {
  AnswerInput,
  CaseInput,
  ControlQuestion,
  Question,
  SeriesFailure,
  SeriesInfo,
} from "../../shared/api.ts";
import type {
  Case,
  CompanyProfile,
  Graph,
  LabelsFile,
  MeasureDef,
  OnePager,
  Pattern,
  ProfileAnswers,
  RoleDef,
  Verdict,
} from "./types.ts";

/** 出典の一覧（GET /api/sources）。会社カルテや判定は含まない */
export type SourcesView = {
  categories: {
    id: string;
    titleJa: string;
    noteJa?: string;
    sources: {
      id: string;
      nameJa: string;
      url: string;
      publisherJa: string;
      licenseJa?: string;
      checkedAt?: string;
      usedForJa: string;
      noticeJa?: string;
      /** ATT&CK の項目だけ（version.json から差し込まれる） */
      version?: string;
    }[];
  }[];
};

export type KnowledgeView = {
  attackVersion: string;
  labels: LabelsFile;
  measures: MeasureDef[];
  questions: Question[];
  /** 緩和策 ID ごとの確認の質問表（カルテ画面の「自分で答える」と確認依頼で同じもの） */
  controlQuestions: ControlQuestion[];
  patterns: Pattern[];
  roles: RoleDef[];
  templates: {
    id: string;
    damageType: string;
    labelJa: string;
    stages: { id: string; labelJa: string }[];
  }[];
};
export type Evaluation = {
  /** 対策 ID → 費用の目安（knowledge/costs.yaml とカルテの人数から） */
  measureCosts?: Record<string, { costJa: string; costSourceJa?: string }>;
  graph: Graph;
  verdict: Verdict;
  measures: MeasureDef[];
  profile: CompanyProfile;
  /** 次の一手：いまの経路で効く対策（早い段階から 3 つ。サーバ側の engine が選ぶ） */
  nextMoves?: { measureId: string; stageJa?: string }[];
};
/** 架空の会社の一覧の 1 件（GET /api/examples） */
export type ExampleSummary = {
  id: string;
  companyName: string;
  patternLabelJa: string;
  employees?: number;
  fictional: boolean;
};
export type RecordedCaseMeta = {
  caseId: string;
  recordedAt?: string;
  model?: string;
  note?: string;
  attackVersion?: string;
};

/** 社長向けの一枚（POST /api/onepager の応答） */
export type OnePagerResponse = {
  onePager: OnePager;
  graph: Graph;
  verdict: Verdict;
  measures: MeasureDef[];
  profile: CompanyProfile;
  text: { source: "claude" | "template"; model?: string; noteJa?: string };
  /** 複数の報を渡したときだけ付く：前の報から変わったこと（プログラムが決定的に比べた固定の文） */
  changes?: {
    summaryJa: string[];
    transitions: { fromLabel: string; toLabel: string; changesJa: string[] }[];
  };
};

export class ApiError extends Error {
  readonly status: number;
  /** 複数の公表を読んで取得に失敗したとき：どの URL がなぜ失敗したか */
  readonly failures: SeriesFailure[] | undefined;
  constructor(status: number, message: string, failures?: SeriesFailure[]) {
    super(message);
    this.status = status;
    this.failures = failures;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    failures?: SeriesFailure[];
  };
  if (!res.ok)
    throw new ApiError(res.status, body.error ?? `API エラー（${res.status}）`, body.failures);
  return body as T;
}
const post = <T>(path: string, body: unknown) =>
  call<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  knowledge: () => call<KnowledgeView>("/api/knowledge"),
  sources: () => call<SourcesView>("/api/sources"),
  examples: () => call<{ items: ExampleSummary[] }>("/api/examples"),
  example: (id: string) => call<{ profile: CompanyProfile; graph: Graph }>(`/api/examples/${id}`),
  health: () => call<{ ok: boolean; readAvailable: boolean }>("/api/health"),
  recordedList: () =>
    call<{ items: { caseId: string; title: string; damageType: string }[] }>("/api/case/recorded"),
  recorded: (id: string) =>
    call<{ case: Case; meta: RecordedCaseMeta }>(`/api/case/recorded/${id}`),
  read: (input: CaseInput) =>
    post<{
      case: Case;
      report: unknown;
      article: {
        title?: string;
        sourceUrl?: string;
        /** 本文が途中で切れていそうな理由（会員向けの案内、末尾が見出し、など） */
        incomplete?: string[];
        truncated?: boolean;
      };
      model: string;
      /** kind: "urls" で 2 件以上を読めたときだけ：報の情報、各報の読解、差分の表 */
      series?: SeriesInfo;
      /** kind: "urls" で 1 件だけ残った（skip）とき：取得に失敗した公表 */
      failures?: SeriesFailure[];
    }>("/api/case/read", { input }),
  /** profileId を渡すと同じ会社のカルテとして作り直す（無ければ新しい会社として新しい ID が付く） */
  fromAnswers: (answers: ProfileAnswers, companyName?: string, profileId?: string) =>
    post<{ profile: CompanyProfile; graph: Graph }>("/api/profile/from-answers", {
      answers,
      ...(companyName ? { companyName } : {}),
      ...(profileId ? { profileId } : {}),
    }),
  evaluate: (body: {
    case: Case;
    profile: CompanyProfile;
    measureIds?: string[];
    answers?: AnswerInput[];
  }) => post<Evaluation>("/api/evaluate", body),
  onepager: (body: {
    case: Case;
    profile: CompanyProfile;
    measureIds?: string[];
    answers?: AnswerInput[];
    rewrite?: boolean;
    /** 複数の報を別々に読んだ結果（古い順）。あるときだけ「前の報から変わったこと」が返る */
    reports?: SeriesInfo["reports"];
  }) => post<OnePagerResponse>("/api/onepager", body),
  demoAudio: () => call<{ available: Record<string, number | true> }>("/api/demo/audio"),
};
