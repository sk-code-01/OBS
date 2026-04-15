import { randomUUID } from "node:crypto";
import type { TraceBatch } from "@clawobs/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestEnv, setupTestEnv, waitFor } from "./helpers.js";

/**
 * End-to-end round-trip: seed a project + key, POST a synthetic batch
 * (agent root + llm child + tool child), then assert rows appear in
 * ClickHouse and the materialized view.
 *
 * Requires a running ClickHouse reachable at CLICKHOUSE_URL (default
 * http://localhost:8123). Bring one up via `docker compose up -d clickhouse`.
 */
describe("ingest e2e", () => {
  let env: TestEnv;

  beforeAll(async () => {
    env = await setupTestEnv();
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  it("rejects unauthenticated requests", async () => {
    const res = await env.app.app.inject({
      method: "POST",
      url: "/v1/traces",
      payload: { sdkVersion: "test/0", spans: [] },
    });
    // either 400 (zod rejects empty spans) or 401 — both prove the happy
    // path isn't reachable without auth. We explicitly test 401 below with a
    // valid-shape payload.
    expect([400, 401]).toContain(res.statusCode);
  });

  it("rejects a bad bearer token", async () => {
    const batch = syntheticBatch();
    const res = await env.app.app.inject({
      method: "POST",
      url: "/v1/traces",
      headers: { authorization: "Bearer not-a-real-key" },
      payload: batch,
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts a batch and persists spans + aggregates the trace", async () => {
    const batch = syntheticBatch();
    const traceId = batch.spans[0].traceId;
    const res = await env.app.app.inject({
      method: "POST",
      url: "/v1/traces",
      headers: { authorization: `Bearer ${env.apiKey}` },
      payload: batch,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: 3, rejected: 0 });

    // Flush the queue to make the assertions deterministic.
    await env.app.app.ready();
    // Queue flushes on a timer; we expose it by closing-then-rebuilding would
    // tear down the HTTP app. Instead, wait on ClickHouse rows to appear.
    const rows = await waitFor(async () => {
      const r = await env.client.query({
        query:
          "SELECT trace_id, span_id, kind, name, provider, model, total_tokens, cost_usd " +
          "FROM spans WHERE trace_id = {trace:String} ORDER BY start_time",
        query_params: { trace: traceId },
        format: "JSONEachRow",
      });
      const json = (await r.json()) as unknown[];
      return json.length === 3 ? json : null;
    });

    const kinds = rows.map((r) => (r as { kind: string }).kind).sort();
    expect(kinds).toEqual(["agent", "llm", "tool"]);

    const llmRow = rows.find((r) => (r as { kind: string }).kind === "llm") as {
      provider: string;
      model: string;
      total_tokens: number;
      cost_usd: number | null;
    };
    expect(llmRow.provider).toBe("anthropic");
    expect(llmRow.model).toBe("claude-sonnet-4-6");
    expect(llmRow.total_tokens).toBe(300);
    // pricing: (100/1000)*3 + (200/1000)*15 = 0.3 + 3 = 3.3
    expect(llmRow.cost_usd).toBeCloseTo(3.3, 4);

    // trace_summary_mv should have one row for this trace.
    const summary = await waitFor(async () => {
      const r = await env.client.query({
        query:
          "SELECT trace_id, llm_call_count, tool_call_count, total_tokens, total_cost_usd " +
          "FROM trace_summary_mv FINAL WHERE trace_id = {trace:String}",
        query_params: { trace: traceId },
        format: "JSONEachRow",
      });
      const json = (await r.json()) as unknown[];
      return json.length === 1 ? (json[0] as Record<string, number>) : null;
    });

    expect(summary.llm_call_count).toBe(1);
    expect(summary.tool_call_count).toBe(1);
    expect(summary.total_tokens).toBe(300);
    expect(Number(summary.total_cost_usd)).toBeCloseTo(3.3, 4);

    const traceList = await env.app.app.inject({
      method: "GET",
      url: "/v1/traces?limit=10",
      headers: { authorization: `Bearer ${env.apiKey}` },
    });
    expect(traceList.statusCode).toBe(200);
    const traceListJson = traceList.json() as {
      items: Array<{
        traceId: string;
        llmCallCount: number;
        toolCallCount: number;
      }>;
    };
    expect(traceListJson.items.some((item) => item.traceId === traceId)).toBe(true);

    const traceDetail = await env.app.app.inject({
      method: "GET",
      url: `/v1/traces/${traceId}`,
      headers: { authorization: `Bearer ${env.apiKey}` },
    });
    expect(traceDetail.statusCode).toBe(200);
    const traceDetailJson = traceDetail.json() as {
      trace: { traceId: string; llmCallCount: number; toolCallCount: number } | null;
      spans: Array<{ kind: string }>;
    };
    expect(traceDetailJson.trace?.traceId).toBe(traceId);
    expect(traceDetailJson.trace?.llmCallCount).toBe(1);
    expect(traceDetailJson.trace?.toolCallCount).toBe(1);
    expect(traceDetailJson.spans).toHaveLength(3);

    const overview = await env.app.app.inject({
      method: "GET",
      url: "/v1/metrics/overview",
      headers: { authorization: `Bearer ${env.apiKey}` },
    });
    expect(overview.statusCode).toBe(200);
    const overviewJson = overview.json() as {
      traceCount: number;
      llmCallCount: number;
      toolCallCount: number;
      totalTokens: number | null;
    };
    expect(overviewJson.traceCount).toBeGreaterThanOrEqual(1);
    expect(overviewJson.llmCallCount).toBeGreaterThanOrEqual(1);
    expect(overviewJson.toolCallCount).toBeGreaterThanOrEqual(1);
    expect(overviewJson.totalTokens).toBeGreaterThanOrEqual(300);
  });
});

function syntheticBatch(): TraceBatch {
  const traceId = `run_${randomUUID()}`;
  const sessionId = `sess_${randomUUID()}`;
  const rootSpan = `span_${randomUUID()}`;
  const t0 = new Date();
  const iso = (offsetMs: number) => new Date(t0.getTime() + offsetMs).toISOString();

  return {
    sdkVersion: "test/0.0.0",
    spans: [
      {
        traceId,
        spanId: rootSpan,
        sessionId,
        kind: "agent",
        name: "agent.run",
        status: "ok",
        startTime: iso(0),
        endTime: iso(1200),
      },
      {
        traceId,
        spanId: `span_${randomUUID()}`,
        parentSpanId: rootSpan,
        sessionId,
        kind: "llm",
        name: "anthropic.messages.stream",
        status: "ok",
        startTime: iso(50),
        endTime: iso(900),
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
        input: { messages: [{ role: "user", content: "hi" }] },
        output: { role: "assistant", content: "hello" },
      },
      {
        traceId,
        spanId: `span_${randomUUID()}`,
        parentSpanId: rootSpan,
        sessionId,
        kind: "tool",
        name: "tool:bash",
        status: "ok",
        startTime: iso(950),
        endTime: iso(1150),
        toolName: "bash",
        input: { command: "ls" },
        output: { stdout: "file.txt\n", exitCode: 0 },
      },
    ],
  };
}
