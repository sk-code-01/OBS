/**
 * Load test: pushes 100k synthetic spans at the running ingest service
 * and reports per-batch latency + span-throughput.
 *
 * Assumes:
 *   - `docker compose up -d` has brought up ClickHouse + the ingest service
 *   - `INGEST_URL` points at the ingest service (default http://localhost:4317)
 *   - `API_KEY` is a valid bearer for a seeded project
 *
 * Usage:
 *   INGEST_URL=... API_KEY=... pnpm -F @clawobs/ingest load
 */
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { IncomingSpan, TraceBatch } from "@clawobs/types";

const URL = process.env.INGEST_URL ?? "http://localhost:4317";
const API_KEY = process.env.API_KEY;
const TOTAL = Number.parseInt(process.env.TOTAL_SPANS ?? "100000", 10);
const BATCH = Number.parseInt(process.env.BATCH_SIZE ?? "500", 10);
const CONCURRENCY = Number.parseInt(process.env.CONCURRENCY ?? "8", 10);

if (!API_KEY) {
  // biome-ignore lint/suspicious/noConsole: CLI
  console.error("API_KEY env var is required");
  process.exit(1);
}

interface BatchResult {
  status: number;
  latencyMs: number;
}

async function sendBatch(batch: TraceBatch): Promise<BatchResult> {
  const t0 = performance.now();
  const res = await fetch(`${URL}/v1/traces`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(batch),
  });
  // Drain body to free the socket.
  await res.arrayBuffer();
  return { status: res.status, latencyMs: performance.now() - t0 };
}

function buildBatch(count: number): TraceBatch {
  const spans: IncomingSpan[] = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const traceId = `load_${randomUUID()}`;
    spans.push({
      traceId,
      spanId: `span_${randomUUID()}`,
      kind: "llm",
      name: "anthropic.messages.stream",
      status: "ok",
      startTime: new Date(now - 1000).toISOString(),
      endTime: new Date(now).toISOString(),
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
      input: { messages: [{ role: "user", content: "load test" }] },
      output: { role: "assistant", content: "ok" },
    });
  }
  return { sdkVersion: "load/0.0.0", spans };
}

async function run(): Promise<void> {
  const totalBatches = Math.ceil(TOTAL / BATCH);
  const latencies: number[] = [];
  let accepted = 0;
  let rejected = 0;
  let nonOk = 0;

  const start = performance.now();

  let next = 0;
  async function worker(): Promise<void> {
    while (next < totalBatches) {
      const i = next++;
      const size = Math.min(BATCH, TOTAL - i * BATCH);
      const res = await sendBatch(buildBatch(size));
      latencies.push(res.latencyMs);
      if (res.status === 202) accepted += size;
      else if (res.status === 429) rejected += size;
      else nonOk += 1;
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const totalSec = (performance.now() - start) / 1000;
  latencies.sort((a, b) => a - b);
  const pct = (p: number): number => latencies[Math.floor((latencies.length - 1) * p)];

  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(
    JSON.stringify(
      {
        totalSpans: TOTAL,
        accepted,
        rejected,
        nonOk,
        durationSec: Number(totalSec.toFixed(2)),
        spansPerSec: Math.round(TOTAL / totalSec),
        latencyMs: {
          p50: Number(pct(0.5).toFixed(2)),
          p90: Number(pct(0.9).toFixed(2)),
          p99: Number(pct(0.99).toFixed(2)),
          max: Number(pct(1).toFixed(2)),
        },
      },
      null,
      2,
    ),
  );
}

run().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: CLI
  console.error(err);
  process.exit(1);
});
