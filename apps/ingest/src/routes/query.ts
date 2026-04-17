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
        "project_id = {projectId:String}",
        "(status != '' OR llm_call_count > 0 OR tool_call_count > 0)",
      ];
      const queryParams: Record<string, string | number> = {
        projectId,
        limit: req.query.limit,
      };

      if (req.query.before) {
        filters.push("started_at < parseDateTime64BestEffort({before:String})");
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
      const items = rows.map(mapTraceSummaryRow);

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

      return {
        trace: traceRows[0] ? mapTraceSummaryRow(traceRows[0]) : null,
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
        "project_id = {projectId:String}",
        "(status != '' OR llm_call_count > 0 OR tool_call_count > 0)",
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

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function numberOrZero(value: unknown): number {
  return numberOrNull(value) ?? 0;
}
