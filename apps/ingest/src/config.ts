/**
 * Runtime config pulled from env vars. Defaults suit local development.
 */
export interface Config {
  port: number;
  host: string;
  logLevel: "trace" | "debug" | "info" | "warn" | "error" | "fatal";

  clickhouseUrl: string;
  clickhouseDb: string;
  clickhouseUser?: string;
  clickhousePassword?: string;

  batchMaxSpans: number;
  batchMaxMs: number;
  queueMaxDepth: number;

  maxPayloadBytes: number;
  maxFieldBytes: number;

  apiKeyCacheTtlMs: number;
  rateLimitPerSec: number;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`env ${name} must be an integer, got "${raw}"`);
  return n;
}

export function loadConfig(): Config {
  return {
    port: intEnv("PORT", 4317),
    host: process.env.HOST ?? "0.0.0.0",
    logLevel: (process.env.LOG_LEVEL as Config["logLevel"]) ?? "info",

    clickhouseUrl: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
    clickhouseDb: process.env.CLICKHOUSE_DB ?? "clawobs",
    clickhouseUser: process.env.CLICKHOUSE_USER,
    clickhousePassword: process.env.CLICKHOUSE_PASSWORD,

    batchMaxSpans: intEnv("BATCH_MAX_SPANS", 1000),
    batchMaxMs: intEnv("BATCH_MAX_MS", 250),
    queueMaxDepth: intEnv("QUEUE_MAX_DEPTH", 50_000),

    maxPayloadBytes: intEnv("MAX_PAYLOAD_MB", 5) * 1024 * 1024,
    maxFieldBytes: intEnv("MAX_FIELD_KB", 256) * 1024,

    apiKeyCacheTtlMs: intEnv("API_KEY_CACHE_TTL_MS", 60_000),
    rateLimitPerSec: intEnv("RATE_LIMIT_PER_SEC", 1000),
  };
}
