# ClawObs

Observability for [openclaw/openclaw](https://github.com/openclaw/openclaw) — think
LangSmith, scoped to OpenClaw. Phase 1 is the ingestion backend: a headless
REST service that accepts trace/span batches and writes them to ClickHouse Cloud.

## Layout

```
apps/
  ingest/                 # Fastify ingestion service (HTTP 4317)
  web/                    # Next.js signup + dashboard app
packages/
  types/                  # shared span/trace TS types
  clickhouse-schema/      # SQL migrations + runner
  plugin-openclaw/        # OpenClaw plugin that streams hooks to ClawObs
```

## Prerequisites

- Node ≥ 20
- pnpm 9
- A ClickHouse Cloud service — sign in at https://clickhouse.cloud
  and grab the HTTPS endpoint, username, and password from the console.

## Setup

1. **Copy the env template and fill in your Cloud credentials:**

   ```bash
   cp .env.example .env
   # then edit .env with your CLICKHOUSE_URL, CLICKHOUSE_PASSWORD, etc.
   ```

2. **Install deps + apply migrations:**

   ```bash
   pnpm install
   pnpm -F @clawobs/clickhouse-schema migrate
   ```

3. **Run the ingest service:**

   ```bash
   pnpm -F @clawobs/ingest dev
   # → http://localhost:4317
   # → http://localhost:4317/docs    (Swagger UI)
   ```

4. **Run the web app locally (optional, requires Postgres + Resend envs):**

   ```bash
   cp apps/web/.env.example apps/web/.env.local
   # then edit apps/web/.env.local with DATABASE_URL, RESEND_API_KEY, and secrets

   pnpm -F @clawobs/web dev
   # → http://localhost:3000
   ```

## Talking to ClickHouse from the terminal (optional)

ClickHouse Cloud has a SQL console built into the web UI, which is usually
enough. If you want a local CLI:

```bash
brew install clickhouse          # installs the `clickhouse` binary
clickhouse client \
  --host <host-from-your-url> \
  --secure \
  --port 9440 \
  --user default \
  --password <password>
```

## Authenticating to the ingest API

Every ingest request needs `Authorization: Bearer <api-key>`.
Seed a project + key via the SQL console (or the CLI above) while the
auth-plane app is still TODO:

```sql
INSERT INTO clawobs.projects (id, slug, name)
VALUES (generateUUIDv4(), 'demo', 'Demo');

INSERT INTO clawobs.api_keys (project_id, key_hash, prefix, name)
SELECT id, lower(hex(SHA256('ck_live_replaceme'))), 'ck_live_', 'first-key'
FROM   clawobs.projects WHERE slug = 'demo';
```

Then send `Authorization: Bearer ck_live_replaceme` on every request.

## Endpoints

| Method | Path            | Purpose                        |
|--------|-----------------|--------------------------------|
| GET    | `/healthz`      | liveness                       |
| GET    | `/readyz`       | ClickHouse reachability check  |
| POST   | `/v1/traces`    | batch span upload              |
| POST   | `/v1/events`    | single span upload             |
| GET    | `/v1/traces`    | list recent traces             |
| GET    | `/v1/traces/:id`| fetch one trace + spans        |
| GET    | `/v1/metrics/overview` | overview cards for frontend |
| GET    | `/docs`         | Swagger UI                     |
| GET    | `/openapi.json` | OpenAPI 3.1 spec               |

## Tests

```bash
# typecheck everything
pnpm typecheck

# end-to-end round-trip (uses the ClickHouse Cloud service from .env)
pnpm -F @clawobs/ingest test:e2e

# OpenClaw plugin unit tests
pnpm -F @clawobs/plugin-openclaw test

# typecheck + build the web app
pnpm -F @clawobs/web typecheck
pnpm -F @clawobs/web build

# load test (requires running ingest service + valid API_KEY)
API_KEY=ck_live_replaceme pnpm -F @clawobs/ingest load
```

## Web app env vars

`apps/web/.env.local` should contain:

| Var                        | Purpose |
|---------------------------|---------|
| `DATABASE_URL`            | Neon/Postgres connection string for auth tables |
| `RESEND_API_KEY`          | magic-link email delivery |
| `SESSION_COOKIE_SECRET`   | 32-byte secret for the session cookie |
| `FIRST_KEY_COOKIE_SECRET` | 32-byte secret for the one-time raw API key cookie |
| `CLICKHOUSE_URL`          | ClickHouse Cloud HTTPS endpoint |
| `CLICKHOUSE_USER`         | ClickHouse username |
| `CLICKHOUSE_PASSWORD`     | ClickHouse password |
| `CLICKHOUSE_DB`           | ClickHouse database name, usually `clawobs` |
| `PUBLIC_INGEST_URL`       | public ingest base URL used in the setup paste-message |
| `PUBLIC_APP_URL`          | public web base URL used in magic-link emails |

## Environment variables (the full list)

| Var                    | Default                  | Purpose                            |
|------------------------|--------------------------|------------------------------------|
| `CLICKHOUSE_URL`       | *(required)*             | ClickHouse Cloud HTTPS endpoint    |
| `CLICKHOUSE_USER`      | *(unset)*                | usually `default`                  |
| `CLICKHOUSE_PASSWORD`  | *(unset)*                | from the Cloud console             |
| `CLICKHOUSE_DB`        | `clawobs`                | logical database name              |
| `PORT`                 | `4317`                   | ingest HTTP listener               |
| `LOG_LEVEL`            | `info`                   | `trace`/`debug`/`info`/`warn`/`error` |
| `BATCH_MAX_SPANS`      | `1000`                   | queue flush trigger                |
| `BATCH_MAX_MS`         | `250`                    | queue flush trigger (ms)           |
| `MAX_PAYLOAD_MB`       | `5`                      | per-request cap                    |
| `MAX_FIELD_KB`         | `256`                    | per-span `input`/`output` cap      |

## What comes next

Implemented now:

- `packages/plugin-openclaw` registers `before_agent_start`, `agent_end`,
  `llm_input`, `llm_output`, `before_tool_call`, `after_tool_call`,
  `session_start`, and `session_end`, correlates them into spans, and batches
  them to `/v1/traces`.
- the backend now exposes headless read APIs for the frontend:
  `GET /v1/traces`, `GET /v1/traces/:id`, and `GET /v1/metrics/overview`.
- `apps/web` now provides magic-link signup, the OpenClaw setup paste-message,
  dashboard overview cards, trace list/detail pages, and API key rotation.
- both `apps/ingest` and `apps/web` include Railway-ready `Dockerfile` and
  `railway.json` configs for public deployment.

Next:

- deploy both services to Railway with real secrets
- provision Neon Postgres + Resend in production
- richer query/filter endpoints for sessions, agents, models, and tools

## OpenClaw plugin setup

The plugin lives in `packages/plugin-openclaw`. It reads either OpenClaw plugin
config or these env vars:

- `CLAWOBS_INGEST_URL`
- `CLAWOBS_API_KEY`
- `CLAWOBS_SAMPLE_RATE`
- `CLAWOBS_FLUSH_AT`
- `CLAWOBS_FLUSH_INTERVAL_MS`
- `CLAWOBS_REQUEST_TIMEOUT_MS`
- `CLAWOBS_MAX_QUEUE_SIZE`
- `CLAWOBS_CAPTURE_INPUTS`
- `CLAWOBS_CAPTURE_OUTPUTS`
- `CLAWOBS_CAPTURE_MESSAGES`

Minimal OpenClaw config:

```json
{
  "plugins": {
    "entries": {
      "clawobs": {
        "enabled": true,
        "config": {
          "ingestUrl": "http://localhost:4317",
          "apiKey": "ck_live_replaceme"
        }
      }
    }
  }
}
```
