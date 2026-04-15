/**
 * Shared types for the ClawObs ingestion protocol.
 *
 * These represent what the OpenClaw plugin (future @clawobs/plugin) sends
 * to the ingest service. The server normalizes these into ClickHouse rows.
 */

export type SpanKind = "agent" | "llm" | "tool" | "channel" | "custom";

export type SpanStatus = "ok" | "error" | "in_progress";

/**
 * OpenClaw supports many provider ids (Anthropic, OpenAI, Groq, OpenRouter,
 * self-hosted bridges, etc), so observability must accept arbitrary provider
 * strings instead of a fixed enum.
 */
export type Provider = string;

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface SpanCost {
  usd: number;
}

export interface SpanError {
  message: string;
  stack?: string;
}

export interface IncomingSpan {
  /** = OpenClaw runId; groups spans into a single agent run. */
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  /** OpenClaw sessionId — groups traces into a conversation thread. */
  sessionId?: string;
  agentId?: string;

  kind: SpanKind;
  /** Human-readable name, e.g. "anthropic.messages.stream", "tool:bash". */
  name: string;
  status: SpanStatus;

  /** ISO-8601 with microseconds (e.g. "2026-04-15T10:30:00.123456Z"). */
  startTime: string;
  endTime?: string;

  // LLM-specific (set only when kind === "llm")
  provider?: Provider;
  model?: string;
  usage?: TokenUsage;
  cost?: SpanCost;

  // Tool-specific (set only when kind === "tool")
  toolName?: string;

  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  error?: SpanError;
}

export interface TraceBatch {
  sdkVersion: string;
  spans: IncomingSpan[];
}

/** Response shape for POST /v1/traces. */
export interface IngestAck {
  accepted: number;
  rejected: number;
  /** Per-span rejection reasons, keyed by spanId. */
  errors?: Record<string, string>;
}

/** Shape that lands in the ClickHouse `spans` table. */
export interface SpanRow {
  project_id: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  session_id: string | null;
  agent_id: string | null;

  kind: SpanKind;
  name: string;
  status: SpanStatus;

  start_time: string;
  end_time: string | null;

  provider: Provider | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;

  tool_name: string | null;

  input: string;
  output: string;
  metadata: string;
  error: string | null;

  sdk_version: string;
}
