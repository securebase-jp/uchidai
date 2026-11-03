/** API クライアント。Claude API のキーはサーバにしかない */
import type { AnswerInput, CaseInput, ControlQuestion, Question } from "../../shared/api.ts";
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
};

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `API エラー（${res.status}）`);
  return body as T;
}
const post = <T>(path: string, body: unknown) =>
  call<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  knowledge: () => call<KnowledgeView>("/api/knowledge"),
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
      article: { title?: string; sourceUrl?: string };
      model: string;
    }>("/api/case/read", { input }),
  fromAnswers: (answers: ProfileAnswers, companyName?: string) =>
    post<{ profile: CompanyProfile; graph: Graph }>("/api/profile/from-answers", {
      answers,
      ...(companyName ? { companyName } : {}),
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
  }) => post<OnePagerResponse>("/api/onepager", body),
  demoAudio: () => call<{ available: Record<string, number | true> }>("/api/demo/audio"),
};
