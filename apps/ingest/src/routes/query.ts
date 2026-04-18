import type { ClickHouseClient } from "@clickhouse/client";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { ApiKeyAuth } from "../auth/api-key.js";
import { resolveProjectIdFromAuthorization } from "./authenticate.js";

const ErrorSchema = z.object({
  error: z.string(),
});

const TraceListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().min(1).optional(),
  sessionId: z.string().min(1).max(128).optional(),
  status: z.enum(["ok", "error", "in_progress"]).optional(),
});

const TraceSummarySchema = z.object({
  traceId: z.string(),
  sessionId: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  status: z.string().nullable(),
  llmCallCount: z.number(),
  toolCallCount: z.number(),
  totalTokens: z.number().nullable(),
  totalCostUsd: z.number().nullable(),
  conversationPreview: z.string().nullable(),
  senderName: z.string().nullable(),
  messageAt: z.string().nullable(),
});

const TraceListResponseSchema = z.object({
  items: z.array(TraceSummarySchema),
  nextCursor: z.string().nullable(),
});

const TraceDetailParamsSchema = z.object({
  traceId: z.string().min(1).max(128),
});

const SpanDetailSchema = z.object({
  spanId: z.string(),
  parentSpanId: z.string().nullable(),
  kind: z.string(),
  name: z.string(),
  status: z.string(),
  startTime: z.string(),
  endTime: z.string().nullable(),
  durationMs: z.number().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  totalTokens: z.number().nullable(),
  costUsd: z.number().nullable(),
  toolName: z.string().nullable(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  metadata: z.unknown().optional(),
  error: z.unknown().optional(),
});

const TraceDetailResponseSchema = z.object({
  trace: TraceSummarySchema.nullable(),
  spans: z.array(SpanDetailSchema),
});

const OverviewQuerySchema = z.object({
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
});

const OverviewResponseSchema = z.object({
  traceCount: z.number(),
  llmCallCount: z.number(),
  toolCallCount: z.number(),
  totalTokens: z.number().nullable(),
  totalCostUsd: z.number().nullable(),
  avgDurationMs: z.number().nullable(),
  p95DurationMs: z.number().nullable(),
});

interface ConversationContext {
  conversationPreview: string | null;
  senderName: string | null;
  messageAt: string | null;
  isInternal: boolean;
}

const TRACE_SUMMARY_INNER_QUERY =
  "SELECT " +
  "trace_id, " +
  "argMax(ifNull(session_id, ''), if(kind = 'agent', 3, if(kind = 'channel' AND name = 'message.received', 2, if(isNotNull(session_id) AND session_id != '', 1, 0)))) AS session_id, " +
  "min(start_time) AS started_at_ts, " +
  "maxOrNull(end_time) AS ended_at_ts, " +
  "argMax(status, if(kind = 'agent', 3, if(kind = 'channel' AND name = 'message.received', 2, if(status != '', 1, 0)))) AS status, " +
  "countIf(kind = 'agent' AND name = 'agent.run') AS agent_run_count, " +
  "countIf(kind = 'llm') AS llm_call_count, " +
  "countIf(kind = 'tool') AS tool_call_count, " +
  "sumOrNull(total_tokens) AS total_tokens, " +
  "sumOrNull(cost_usd) AS total_cost_usd, " +
  "countIf(kind = 'channel' AND name = 'message.received') AS channel_message_count " +
  "FROM spans " +
  "WHERE project_id = {projectId:String} " +
  "GROUP BY trace_id";

export async function registerQueryRoutes(
  app: FastifyInstance,
  deps: {
    clickhouse: ClickHouseClient;
    auth: ApiKeyAuth;
  },
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.route({
    method: "GET",
    url: "/v1/traces",
    schema: {
      summary: "List recent traces for the authenticated project",
      tags: ["query"],
      querystring: TraceListQuerySchema,
      response: {
        200: TraceListResponseSchema,
        401: ErrorSchema,
      },
    },
    handler: async (req, reply) => {
      const projectId = await resolveProjectIdFromAuthorization(
        req.headers.authorization,
        deps.auth,
      );
      if (!projectId) {
        return reply.code(401).send({ error: "invalid_api_key" });
      }

      const filters = [
        "(agent_run_count > 0 OR llm_call_count > 0 OR tool_call_count > 0 OR channel_message_count > 0)",
      ];
      const queryParams: Record<string, string | number> = {
        projectId,
        limit: req.query.limit,
      };

      if (req.query.before) {
        filters.push("started_at_ts < parseDateTime64BestEffort({before:String})");
        queryParams.before = req.query.before;
      }
      if (req.query.sessionId) {
        filters.push("session_id = {sessionId:String}");
        queryParams.sessionId = req.query.sessionId;
      }
      if (req.query.status) {
        filters.push("status = {status:String}");
        queryParams.status = req.query.status;
      }

      const result = await deps.clickhouse.query({
        query:
          "SELECT " +
          "trace_id, " +
          "nullIf(session_id, '') AS session_id, " +
          "toString(started_at_ts) AS started_at, " +
          "if(isNull(ended_at_ts), NULL, toString(ended_at_ts)) AS ended_at, " +
          "nullIf(status, '') AS status, " +
          "llm_call_count, " +
          "tool_call_count, " +
          "total_tokens, " +
          "total_cost_usd " +
          `FROM (${TRACE_SUMMARY_INNER_QUERY}) ` +
          `WHERE ${filters.join(" AND ")} ` +
          "ORDER BY started_at_ts DESC " +
          "LIMIT {limit:UInt32}",
        query_params: queryParams,
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as Array<Record<string, unknown>>;
      const enriched = await enrichTraceSummariesWithConversationContext(
        deps.clickhouse,
        projectId,
        rows.map(mapTraceSummaryRow),
      );
      const items = enriched
        .filter((item) => !(item as ReturnType<typeof mapTraceSummaryRow> & { isInternal?: boolean }).isInternal)
        .map(stripInternalFlag);

      return {
        items,
        nextCursor: items.length === req.query.limit ? items.at(-1)?.startedAt ?? null : null,
      };
    },
  });

  typed.route({
    method: "GET",
    url: "/v1/traces/:traceId",
    schema: {
      summary: "Fetch one trace plus its ordered spans",
      tags: ["query"],
      params: TraceDetailParamsSchema,
      response: {
        200: TraceDetailResponseSchema,
        401: ErrorSchema,
      },
    },
    handler: async (req, reply) => {
      const projectId = await resolveProjectIdFromAuthorization(
        req.headers.authorization,
        deps.auth,
      );
      if (!projectId) {
        return reply.code(401).send({ error: "invalid_api_key" });
      }

      const traceResult = await deps.clickhouse.query({
        query:
          "SELECT " +
          "trace_id, " +
          "nullIf(session_id, '') AS session_id, " +
          "toString(started_at_ts) AS started_at, " +
          "if(isNull(ended_at_ts), NULL, toString(ended_at_ts)) AS ended_at, " +
          "nullIf(status, '') AS status, " +
          "llm_call_count, " +
          "tool_call_count, " +
          "total_tokens, " +
          "total_cost_usd " +
          `FROM (${TRACE_SUMMARY_INNER_QUERY}) ` +
          "WHERE trace_id = {traceId:String} " +
          "LIMIT 1",
        query_params: { projectId, traceId: req.params.traceId },
        format: "JSONEachRow",
      });
      const traceRows = (await traceResult.json()) as Array<Record<string, unknown>>;

      const spansResult = await deps.clickhouse.query({
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
        query_params: { projectId, traceId: req.params.traceId },
        format: "JSONEachRow",
      });
      const spanRows = (await spansResult.json()) as Array<Record<string, unknown>>;
      const conversationContext = extractConversationContextFromSpanRows(spanRows);

      return {
        trace: traceRows[0]
          ? stripInternalFlag({ ...mapTraceSummaryRow(traceRows[0]), ...conversationContext })
          : null,
        spans: spanRows.map(mapSpanRow),
      };
    },
  });

  typed.route({
    method: "GET",
    url: "/v1/metrics/overview",
    schema: {
      summary: "Overview cards for the authenticated project",
      tags: ["query"],
      querystring: OverviewQuerySchema,
      response: {
        200: OverviewResponseSchema,
        401: ErrorSchema,
      },
    },
    handler: async (req, reply) => {
      const projectId = await resolveProjectIdFromAuthorization(
        req.headers.authorization,
        deps.auth,
      );
      if (!projectId) {
        return reply.code(401).send({ error: "invalid_api_key" });
      }

      const filters = [
        "(agent_run_count > 0 OR llm_call_count > 0 OR tool_call_count > 0 OR channel_message_count > 0)",
      ];
      const queryParams: Record<string, string> = { projectId };
      if (req.query.from) {
        filters.push("started_at >= parseDateTime64BestEffort({from:String})");
        queryParams.from = req.query.from;
      }
      if (req.query.to) {
        filters.push("started_at <= parseDateTime64BestEffort({to:String})");
        queryParams.to = req.query.to;
      }

      const result = await deps.clickhouse.query({
        query:
          "SELECT " +
          "count() AS trace_count, " +
          "sum(llm_call_count) AS llm_call_count_total, " +
          "sum(tool_call_count) AS tool_call_count_total, " +
          "sumOrNull(total_tokens) AS total_tokens_sum, " +
          "sumOrNull(total_cost_usd) AS total_cost_usd_sum, " +
          "avgIf(dateDiff('millisecond', started_at_ts, ended_at_ts), isNotNull(ended_at_ts)) AS avg_duration_ms, " +
          "quantileIf(0.95)(dateDiff('millisecond', started_at_ts, ended_at_ts), isNotNull(ended_at_ts)) AS p95_duration_ms " +
          `FROM (${TRACE_SUMMARY_INNER_QUERY}) ` +
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
    },
  });
}

function mapTraceSummaryRow(row: Record<string, unknown>) {
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

function mapSpanRow(row: Record<string, unknown>) {
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

function directString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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
  clickhouse: ClickHouseClient,
  projectId: string,
  items: Array<ReturnType<typeof mapTraceSummaryRow>>,
) {
  if (items.length === 0) return items;

  const result = await clickhouse.query({
    query:
      "SELECT trace_id, kind, name, input " +
      "FROM spans " +
      "WHERE project_id = {projectId:String} " +
      "AND has({traceIds:Array(String)}, trace_id) " +
      "AND ((kind = 'agent' AND name = 'agent.run') OR kind = 'llm' OR (kind = 'channel' AND name = 'message.received')) " +
      "ORDER BY trace_id ASC, if(kind = 'agent' AND name = 'agent.run', 0, if(kind = 'llm', 1, 2)) ASC, start_time ASC " +
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
    if (!isPreferredConversationContextRow(row)) continue;
    const context = extractConversationContextFromInput(row.input);
    if (hasConversationContext(context)) return context;
  }

  for (const row of rows) {
    const context = extractConversationContextFromInput(row.input);
    if (hasConversationContext(context)) return context;
  }

  return emptyConversationContext();
}

function extractConversationContextFromInput(value: unknown): ConversationContext {
  const payload = parseJsonColumn(value);
  if (!payload || typeof payload !== "object") return emptyConversationContext();

  const record = payload as Record<string, unknown>;
  const prompt = record.prompt;
  if (typeof prompt !== "string" || prompt.length === 0) {
    return emptyConversationContext();
  }

  return {
    conversationPreview: extractConversationPreview(prompt),
    senderName:
      directString(record.sender) ??
      directString(record.senderName) ??
      directString(record.name) ??
      matchJsonString(prompt, "sender") ??
      matchJsonString(prompt, "name") ??
      null,
    messageAt:
      directString(record.timestamp) ??
      directString(record.messageAt) ??
      matchJsonString(prompt, "timestamp"),
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

function isPreferredConversationContextRow(row: Record<string, unknown>): boolean {
  return (
    (String(row.kind) === "agent" && String(row.name) === "agent.run") ||
    String(row.kind) === "llm" ||
    (String(row.kind) === "channel" && String(row.name) === "message.received")
  );
}

function hasConversationContext(context: ConversationContext): boolean {
  return Boolean(
    context.conversationPreview || context.senderName || context.messageAt || context.isInternal,
  );
}

function isInternalConversationPrompt(prompt: string): boolean {
  const normalized = prompt.trim();
  return normalized.startsWith("Read HEARTBEAT.md if it exists");
}

function stripInternalFlag(
  trace: ReturnType<typeof mapTraceSummaryRow> & { isInternal?: boolean },
): ReturnType<typeof mapTraceSummaryRow> {
  const { isInternal: _isInternal, ...rest } = trace;
  return rest;
}
