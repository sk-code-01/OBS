import { clickhouse } from "./client";

export interface TraceSummary {
  traceId: string;
  sessionId: string | null;
  startedAt: string;
  endedAt: string | null;
  status: string | null;
  llmCallCount: number;
  toolCallCount: number;
  totalTokens: number | null;
  totalCostUsd: number | null;
  conversationPreview: string | null;
  senderName: string | null;
  messageAt: string | null;
}

export interface TraceListParams {
  limit?: number;
  before?: string;
  sessionId?: string;
  status?: "ok" | "error" | "in_progress";
}

export interface SpanDetail {
  spanId: string;
  parentSpanId: string | null;
  kind: string;
  name: string;
  status: string;
  startTime: string;
  endTime: string | null;
  durationMs: number | null;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  toolName: string | null;
  input?: unknown;
  output?: unknown;
  metadata?: unknown;
  error?: unknown;
}

export interface TraceDetail {
  trace: TraceSummary | null;
  spans: SpanDetail[];
}

export interface Overview {
  traceCount: number;
  llmCallCount: number;
  toolCallCount: number;
  totalTokens: number | null;
  totalCostUsd: number | null;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
}

interface ConversationContext {
  conversationPreview: string | null;
  senderName: string | null;
  messageAt: string | null;
  isInternal: boolean;
}

export async function listTraces(
  projectId: string,
  params: TraceListParams = {},
): Promise<{ items: TraceSummary[]; nextCursor: string | null }> {
  const requestedLimit = params.limit ?? 50;
  const fetchLimit = Math.min(requestedLimit * 5, 200);
  const filters = [
    "project_id = {projectId:String}",
    "(status != '' OR llm_call_count > 0 OR tool_call_count > 0)",
  ];
  const queryParams: Record<string, string | number> = {
    projectId,
    limit: fetchLimit,
  };

  if (params.before) {
    filters.push("started_at < parseDateTime64BestEffort({before:String})");
    queryParams.before = params.before;
  }
  if (params.sessionId) {
    filters.push("session_id = {sessionId:String}");
    queryParams.sessionId = params.sessionId;
  }
  if (params.status) {
    filters.push("status = {status:String}");
    queryParams.status = params.status;
  }

  const result = await clickhouse.query({
    query:
      "SELECT " +
      "trace_id, " +
      "nullIf(session_id, '') AS session_id, " +
      "toString(started_at) AS started_at, " +
      "if(isNull(ended_at), NULL, toString(ended_at)) AS ended_at, " +
      "nullIf(status, '') AS status, " +
      "llm_call_count, " +
      "tool_call_count, " +
      "total_tokens, " +
      "total_cost_usd " +
      "FROM trace_summary_mv FINAL " +
      `WHERE ${filters.join(" AND ")} ` +
      "ORDER BY started_at DESC " +
      "LIMIT {limit:UInt32}",
    query_params: queryParams,
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as Array<Record<string, unknown>>;
  const enrichedItems = await enrichTraceSummariesWithConversationContext(
    projectId,
    rows.map(mapTraceSummaryRow),
  );
  const items = enrichedItems
    .filter((item) => !(item as TraceSummary & { isInternal?: boolean }).isInternal)
    .slice(0, requestedLimit);
  return {
    items: items.map(stripInternalFlag),
    nextCursor: items.length === requestedLimit ? items.at(-1)?.startedAt ?? null : null,
  };
}

export async function getTrace(projectId: string, traceId: string): Promise<TraceDetail> {
  const traceResult = await clickhouse.query({
    query:
      "SELECT " +
      "trace_id, " +
      "nullIf(session_id, '') AS session_id, " +
      "toString(started_at) AS started_at, " +
      "if(isNull(ended_at), NULL, toString(ended_at)) AS ended_at, " +
      "nullIf(status, '') AS status, " +
      "llm_call_count, " +
      "tool_call_count, " +
      "total_tokens, " +
      "total_cost_usd " +
      "FROM trace_summary_mv FINAL " +
      "WHERE project_id = {projectId:String} AND trace_id = {traceId:String} " +
      "LIMIT 1",
    query_params: { projectId, traceId },
    format: "JSONEachRow",
  });

  const spansResult = await clickhouse.query({
    query:
      "SELECT " +
      "span_id, parent_span_id, kind, name, status, " +
      "toString(start_time) AS start_time, " +
      "if(isNull(end_time), NULL, toString(end_time)) AS end_time, " +
      "duration_ms, provider, model, input_tokens, output_tokens, total_tokens, " +
      "cost_usd, tool_name, input, output, metadata, error " +
      "FROM spans " +
      "WHERE project_id = {projectId:String} AND trace_id = {traceId:String} " +
      "ORDER BY start_time ASC, span_id ASC " +
      "LIMIT 1 BY span_id",
    query_params: { projectId, traceId },
    format: "JSONEachRow",
  });

  const traceRows = (await traceResult.json()) as Array<Record<string, unknown>>;
  const spanRows = (await spansResult.json()) as Array<Record<string, unknown>>;
  const conversationContext = extractConversationContextFromSpanRows(spanRows);
  return {
    trace: traceRows[0]
      ? stripInternalFlag({ ...mapTraceSummaryRow(traceRows[0]), ...conversationContext })
      : null,
    spans: spanRows.map(mapSpanRow),
  };
}

export async function getOverview(
  projectId: string,
  params: { from?: string; to?: string } = {},
): Promise<Overview> {
  const filters = [
    "project_id = {projectId:String}",
    "(status != '' OR llm_call_count > 0 OR tool_call_count > 0)",
  ];
  const queryParams: Record<string, string> = { projectId };
  if (params.from) {
    filters.push("started_at >= parseDateTime64BestEffort({from:String})");
    queryParams.from = params.from;
  }
  if (params.to) {
    filters.push("started_at <= parseDateTime64BestEffort({to:String})");
    queryParams.to = params.to;
  }

  const result = await clickhouse.query({
    query:
      "SELECT " +
      "count() AS trace_count, " +
      "sum(llm_call_count) AS llm_call_count_total, " +
      "sum(tool_call_count) AS tool_call_count_total, " +
      "sumOrNull(total_tokens) AS total_tokens_sum, " +
      "sumOrNull(total_cost_usd) AS total_cost_usd_sum, " +
      "avgIf(dateDiff('millisecond', started_at, ended_at), isNotNull(ended_at)) AS avg_duration_ms, " +
      "quantileIf(0.95)(dateDiff('millisecond', started_at, ended_at), isNotNull(ended_at)) AS p95_duration_ms " +
      "FROM trace_summary_mv FINAL " +
      `WHERE ${filters.join(" AND ")}`,
    query_params: queryParams,
    format: "JSONEachRow",
  });

  const row = ((await result.json()) as Array<Record<string, unknown>>)[0] ?? {};
  return {
    traceCount: numberOrZero(row.trace_count),
    llmCallCount: numberOrZero(row.llm_call_count_total),
    toolCallCount: numberOrZero(row.tool_call_count_total),
    totalTokens: numberOrNull(row.total_tokens_sum),
    totalCostUsd: numberOrNull(row.total_cost_usd_sum),
    avgDurationMs: numberOrNull(row.avg_duration_ms),
    p95DurationMs: numberOrNull(row.p95_duration_ms),
  };
}

function mapTraceSummaryRow(row: Record<string, unknown>): TraceSummary {
  return {
    traceId: String(row.trace_id),
    sessionId: stringOrNull(row.session_id),
    startedAt: String(row.started_at),
    endedAt: stringOrNull(row.ended_at),
    status: stringOrNull(row.status),
    llmCallCount: numberOrZero(row.llm_call_count),
    toolCallCount: numberOrZero(row.tool_call_count),
    totalTokens: numberOrNull(row.total_tokens),
    totalCostUsd: numberOrNull(row.total_cost_usd),
    conversationPreview: stringOrNull(row.conversation_preview),
    senderName: stringOrNull(row.sender_name),
    messageAt: stringOrNull(row.message_at),
  };
}

function mapSpanRow(row: Record<string, unknown>): SpanDetail {
  return {
    spanId: String(row.span_id),
    parentSpanId: stringOrNull(row.parent_span_id),
    kind: String(row.kind),
    name: String(row.name),
    status: String(row.status),
    startTime: String(row.start_time),
    endTime: stringOrNull(row.end_time),
    durationMs: numberOrNull(row.duration_ms),
    provider: stringOrNull(row.provider),
    model: stringOrNull(row.model),
    inputTokens: numberOrNull(row.input_tokens),
    outputTokens: numberOrNull(row.output_tokens),
    totalTokens: numberOrNull(row.total_tokens),
    costUsd: numberOrNull(row.cost_usd),
    toolName: stringOrNull(row.tool_name),
    input: parseJsonColumn(row.input),
    output: parseJsonColumn(row.output),
    metadata: parseJsonColumn(row.metadata),
    error: parseJsonColumn(row.error),
  };
}

function parseJsonColumn(value: unknown): unknown | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function numberOrZero(value: unknown): number {
  return numberOrNull(value) ?? 0;
}

async function enrichTraceSummariesWithConversationContext(
  projectId: string,
  items: TraceSummary[],
): Promise<Array<TraceSummary & { isInternal: boolean }>> {
  if (items.length === 0) return [];

  const result = await clickhouse.query({
    query:
      "SELECT trace_id, input " +
      "FROM spans " +
      "WHERE project_id = {projectId:String} " +
      "AND kind = 'agent' " +
      "AND name = 'agent.run' " +
      "AND has({traceIds:Array(String)}, trace_id) " +
      "ORDER BY trace_id ASC, start_time ASC " +
      "LIMIT 1 BY trace_id",
    query_params: {
      projectId,
      traceIds: items.map((item) => item.traceId),
    },
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as Array<Record<string, unknown>>;
  const contextByTraceId = new Map<string, ConversationContext>(
    rows.map((row) => [String(row.trace_id), extractConversationContextFromInput(row.input)]),
  );

  return items.map((item) => ({
    ...item,
    ...(contextByTraceId.get(item.traceId) ?? emptyConversationContext()),
  }));
}

function extractConversationContextFromSpanRows(
  rows: Array<Record<string, unknown>>,
): ConversationContext {
  for (const row of rows) {
    if (String(row.kind) !== "agent" || String(row.name) !== "agent.run") continue;
    return extractConversationContextFromInput(row.input);
  }

  return emptyConversationContext();
}

function extractConversationContextFromInput(value: unknown): ConversationContext {
  const payload = parseJsonColumn(value);
  if (!payload || typeof payload !== "object") return emptyConversationContext();

  const prompt = (payload as Record<string, unknown>).prompt;
  if (typeof prompt !== "string" || prompt.length === 0) {
    return emptyConversationContext();
  }

  return {
    conversationPreview: extractConversationPreview(prompt),
    senderName:
      matchJsonString(prompt, "sender") ??
      matchJsonString(prompt, "name") ??
      null,
    messageAt: matchJsonString(prompt, "timestamp"),
    isInternal: isInternalConversationPrompt(prompt),
  };
}

function extractConversationPreview(prompt: string): string | null {
  const normalized = prompt.replace(/\r\n/g, "\n").trim();
  const lastFence = normalized.lastIndexOf("```");
  if (lastFence !== -1) {
    const tail = normalized
      .slice(lastFence + 3)
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);
    if (tail) return truncatePreview(tail);
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (
      line.startsWith("```") ||
      line.startsWith("{") ||
      line.startsWith("}") ||
      line.includes("Conversation info") ||
      line.includes("Sender (")
    ) {
      continue;
    }
    return truncatePreview(line);
  }

  return null;
}

function matchJsonString(source: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`"${escapedKey}"\\s*:\\s*"([^"]+)"`));
  return match?.[1]?.trim() ? match[1].trim() : null;
}

function truncatePreview(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 140 ? `${compact.slice(0, 137)}...` : compact;
}

function emptyConversationContext(): ConversationContext {
  return {
    conversationPreview: null,
    senderName: null,
    messageAt: null,
    isInternal: false,
  };
}

function isInternalConversationPrompt(prompt: string): boolean {
  const normalized = prompt.trim();
  return normalized.startsWith("Read HEARTBEAT.md if it exists");
}

function stripInternalFlag(
  trace: TraceSummary & { isInternal?: boolean },
): TraceSummary {
  const { isInternal: _isInternal, ...rest } = trace;
  return rest;
}
