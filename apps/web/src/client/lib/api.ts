/** API クライアント。Claude API のキーはサーバにしかない */
import type { AnswerInput, CaseInput, Question } from "../../shared/api.ts";
import type {
  Case,
  CompanyProfile,
  Graph,
  LabelsFile,
  MeasureDef,
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
  graph: Graph;
  verdict: Verdict;
  measures: MeasureDef[];
  profile: CompanyProfile;
};
export type RecordedCaseMeta = {
  caseId: string;
  recordedAt?: string;
  model?: string;
  note?: string;
  attackVersion?: string;
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
  example: (id: string) => call<{ profile: CompanyProfile; graph: Graph }>(`/api/examples/${id}`),
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
};
