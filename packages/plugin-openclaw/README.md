# @clawobs/plugin-openclaw

First-party OpenClaw plugin that streams agent, LLM, tool, and session
lifecycle telemetry into ClawObs.

## What it captures

- Agent runs via `before_agent_start` + `agent_end`
- LLM calls via `llm_input` + `llm_output`
- Tool calls via `before_tool_call` + `after_tool_call`
- Session lifecycle via `session_start` + `session_end`

## Config

You can configure the plugin either through `plugins.entries.clawobs.config`
inside OpenClaw or with environment variables:

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

Minimal config:

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
