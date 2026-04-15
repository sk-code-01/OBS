-- ClawObs schema 0001 — initial tables.
--
-- Statements are separated by `-- @@` lines. The migration runner splits on
-- that delimiter and executes each statement individually (the ClickHouse
-- HTTP client rejects multi-statement requests).
--
-- `__DB__` is replaced with the configured database name at runtime.

CREATE DATABASE IF NOT EXISTS __DB__
-- @@

CREATE TABLE IF NOT EXISTS __DB__.spans (
  project_id       String,
  trace_id         String,
  span_id          String,
  parent_span_id   Nullable(String),
  session_id       Nullable(String),
  agent_id         Nullable(String),

  kind             LowCardinality(String),
  name             String,
  status           LowCardinality(String),

  start_time       DateTime64(6, 'UTC'),
  end_time         Nullable(DateTime64(6, 'UTC')),
  duration_ms      Nullable(UInt32) MATERIALIZED
                     if(isNotNull(end_time),
                        toUInt32(dateDiff('millisecond', start_time, end_time)),
                        NULL),

  provider         LowCardinality(Nullable(String)),
  model            LowCardinality(Nullable(String)),
  input_tokens     Nullable(UInt32),
  output_tokens    Nullable(UInt32),
  total_tokens     Nullable(UInt32),
  cost_usd         Nullable(Float64),

  tool_name        LowCardinality(Nullable(String)),

  input            String CODEC(ZSTD(3)),
  output           String CODEC(ZSTD(3)),
  metadata         String CODEC(ZSTD(3)),
  error            Nullable(String),

  received_at      DateTime64(3, 'UTC') DEFAULT now64(3),
  sdk_version      LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (project_id, trace_id, start_time, span_id)
TTL toDateTime(start_time) + INTERVAL 90 DAY
-- @@

CREATE MATERIALIZED VIEW IF NOT EXISTS __DB__.trace_summary_mv
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(started_at)
ORDER BY (project_id, trace_id)
POPULATE AS
SELECT
  project_id,
  trace_id,
  anyIf(session_id, kind = 'agent')   AS session_id,
  min(start_time)                     AS started_at,
  maxOrNull(end_time)                 AS ended_at,
  countIf(kind = 'llm')               AS llm_call_count,
  countIf(kind = 'tool')              AS tool_call_count,
  sumOrNull(total_tokens)             AS total_tokens,
  sumOrNull(cost_usd)                 AS total_cost_usd,
  anyIf(status, kind = 'agent')       AS status
FROM __DB__.spans
GROUP BY project_id, trace_id
-- @@

CREATE TABLE IF NOT EXISTS __DB__.projects (
  id           UUID,
  slug         String,
  name         String,
  created_at   DateTime DEFAULT now(),
  deleted_at   Nullable(DateTime)
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY id
-- @@

CREATE TABLE IF NOT EXISTS __DB__.api_keys (
  project_id   UUID,
  key_hash     FixedString(64),
  prefix       String,
  name         String,
  created_at   DateTime DEFAULT now(),
  revoked_at   Nullable(DateTime)
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (project_id, key_hash)
