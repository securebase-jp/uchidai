/**
 * Claude 呼び出しの共通部分。API キーはサーバ側の環境変数からだけ使う。
 * 出力は構造化出力（JSON スキーマ強制）で受け、呼び出し側が zod で検証する。
 */
import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_MODEL = "claude-sonnet-5-5";

export function defaultModel(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

export type LlmOptions = {
  client?: Anthropic;
  model?: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
};

export type ReadErrorKind = "refusal" | "truncated" | "no_text" | "invalid_json" | "schema";

export class ReadError extends Error {
  readonly kind: ReadErrorKind;
  readonly details: unknown;
  constructor(kind: ReadErrorKind, message: string, details?: unknown) {
    super(message);
    this.name = "ReadError";
    this.kind = kind;
    this.details = details;
  }
}

export type StructuredResult<T> = {
  value: T;
  /** スキーマ検証前の生の JSON（記録用） */
  raw: unknown;
  model: string;
  usage: Anthropic.Usage;
};

let shared: Anthropic | undefined;
export function getClient(opts: LlmOptions): Anthropic {
  if (opts.client) return opts.client;
  shared ??= new Anthropic();
  return shared;
}

/**
 * system（指示文）と user（記事などのデータ）を分けて渡し、JSON スキーマに従う出力を得る。
 * 指示文はキャッシュできるように system 側に置く。
 */
export async function callStructured<T>(
  opts: LlmOptions,
  req: {
    system: Anthropic.TextBlockParam[];
    user: string;
    schema: Record<string, unknown>;
    parse: (v: unknown) => T;
  },
): Promise<StructuredResult<T>> {
  const client = getClient(opts);
  const model = opts.model ?? defaultModel();
  const outputConfig: Anthropic.OutputConfig = {
    format: { type: "json_schema", schema: req.schema },
  };
  if (opts.effort) outputConfig.effort = opts.effort;
  const res = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 16000,
    system: req.system,
    messages: [{ role: "user", content: req.user }],
    output_config: outputConfig,
  });
  if (res.stop_reason === "refusal") {
    throw new ReadError(
      "refusal",
      `Claude が応答を拒否しました（${res.stop_details?.category ?? "分類なし"}）`,
      res.stop_details,
    );
  }
  if (res.stop_reason === "max_tokens") {
    throw new ReadError("truncated", "応答が max_tokens で途切れました", { usage: res.usage });
  }
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text) throw new ReadError("no_text", "応答にテキストがありません", res.content);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ReadError("invalid_json", "応答が JSON として読めません", { text, error: String(e) });
  }
  let value: T;
  try {
    value = req.parse(raw);
  } catch (e) {
    throw new ReadError("schema", "応答がスキーマに合いません", { raw, error: String(e) });
  }
  return { value, raw, model: res.model, usage: res.usage };
}
