import type { IncomingSpan, SpanRow } from "@clawobs/types";
import { estimateCostUsd } from "./pricing.js";

interface NormalizeOptions {
  projectId: string;
  sdkVersion: string;
  maxFieldBytes: number;
}

/**
 * Coerce a validated IncomingSpan into the row shape ClickHouse expects.
 *
 * - Timestamps are passed through as ISO strings; ClickHouse parses DateTime64.
 * - `input`/`output`/`metadata` are JSON-stringified, then truncated if they
 *   blow past `maxFieldBytes`. A truncation marker is kept so consumers know.
 * - `cost_usd` is taken from the payload if present, otherwise estimated from
 *   model + usage via the built-in pricing table (null on unknown models).
 */
export function normalize(span: IncomingSpan, opts: NormalizeOptions): SpanRow {
  const input = truncateJson(span.input, opts.maxFieldBytes);
  const output = truncateJson(span.output, opts.maxFieldBytes);
  const metadata = truncateJson(span.metadata ?? {}, opts.maxFieldBytes);

  const inputTokens = span.usage?.inputTokens ?? null;
  const outputTokens = span.usage?.outputTokens ?? null;
  const totalTokens =
    span.usage?.totalTokens ??
    (inputTokens !== null || outputTokens !== null
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : null);

  const costUsd =
    span.cost?.usd ??
    estimateCostUsd(span.model, inputTokens ?? undefined, outputTokens ?? undefined);

  return {
    project_id: opts.projectId,
    trace_id: span.traceId,
    span_id: span.spanId,
    parent_span_id: span.parentSpanId ?? null,
    session_id: span.sessionId ?? null,
    agent_id: span.agentId ?? null,

    kind: span.kind,
    name: span.name,
    status: span.status,

    start_time: normalizeTimestamp(span.startTime),
    end_time: span.endTime ? normalizeTimestamp(span.endTime) : null,

    provider: span.provider ?? null,
    model: span.model ?? null,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    cost_usd: costUsd,

    tool_name: span.toolName ?? null,

    input,
    output,
    metadata,
    error: span.error ? JSON.stringify(span.error) : null,

    sdk_version: opts.sdkVersion,
  };
}

function truncateJson(value: unknown, maxBytes: number): string {
  if (value === undefined) return "";
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") <= maxBytes) return serialized;
  return JSON.stringify({ _truncated: true, preview: serialized.slice(0, maxBytes - 64) });
}

/**
 * ClickHouse DateTime64 accepts ISO-ish strings. Strip the trailing `Z` and
 * the `T` separator — ClickHouse prefers `YYYY-MM-DD HH:MM:SS.ffffff`.
 */
function normalizeTimestamp(iso: string): string {
  return iso.replace("T", " ").replace(/Z$/, "");
}
