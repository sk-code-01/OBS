import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClawObsPluginConfig } from "../src/config.js";
import { ClawObsRuntime } from "../src/runtime.js";

function createConfig(overrides: Partial<ClawObsPluginConfig> = {}): ClawObsPluginConfig {
  return {
    ingestUrl: "http://localhost:4317",
    apiKey: "ck_test_123",
    sdkVersion: "test/0.0.0",
    flushAt: 100,
    flushIntervalMs: 60_000,
    requestTimeoutMs: 5_000,
    maxQueueSize: 1_000,
    captureInputs: true,
    captureOutputs: true,
    captureMessages: true,
    sampleRate: 1,
    ...overrides,
  };
}

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("ClawObsRuntime", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("correlates agent, llm, and tool hooks into one trace tree", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const runtime = new ClawObsRuntime({
      config: createConfig(),
      logger: createLogger(),
    });

    runtime.start();
    runtime.onBeforeAgentStart(
      {
        prompt: "Fix the bug",
        messages: [{ role: "user", content: "Fix the bug" }],
      },
      {
        runId: "run-123",
        agentId: "main",
        sessionId: "session-1",
        sessionKey: "agent:main:session-1",
        workspaceDir: "/tmp/workspace",
        trigger: "message",
        channelId: "telegram",
      },
    );
    runtime.onLlmInput(
      {
        runId: "run-123",
        sessionId: "session-1",
        provider: "openrouter",
        model: "anthropic/claude-sonnet-4-6",
        systemPrompt: "Be helpful",
        prompt: "Fix the bug",
        historyMessages: [{ role: "user", content: "Fix the bug" }],
        imagesCount: 0,
      },
      {
        runId: "run-123",
        agentId: "main",
        sessionId: "session-1",
      },
    );
    runtime.onLlmOutput(
      {
        runId: "run-123",
        sessionId: "session-1",
        provider: "openrouter",
        model: "anthropic/claude-sonnet-4-6",
        assistantTexts: ["Done"],
        lastAssistant: { role: "assistant", content: "Done" },
        usage: {
          input: 120,
          output: 80,
          total: 200,
        },
      },
      {
        runId: "run-123",
        agentId: "main",
        sessionId: "session-1",
      },
    );
    runtime.onBeforeToolCall(
      {
        toolName: "exec_command",
        params: { cmd: "npm test" },
        runId: "run-123",
        toolCallId: "tool-1",
      },
      {
        toolName: "exec_command",
        runId: "run-123",
        toolCallId: "tool-1",
        agentId: "main",
        sessionId: "session-1",
      },
    );
    runtime.onAfterToolCall(
      {
        toolName: "exec_command",
        params: { cmd: "npm test" },
        runId: "run-123",
        toolCallId: "tool-1",
        result: { exitCode: 0, stdout: "ok" },
        durationMs: 42,
      },
      {
        toolName: "exec_command",
        runId: "run-123",
        toolCallId: "tool-1",
        agentId: "main",
        sessionId: "session-1",
      },
    );
    runtime.onAgentEnd(
      {
        messages: [
          { role: "user", content: "Fix the bug" },
          { role: "assistant", content: "Done" },
        ],
        success: true,
        durationMs: 500,
      },
      {
        runId: "run-123",
        agentId: "main",
        sessionId: "session-1",
        sessionKey: "agent:main:session-1",
      },
    );

    await runtime.stop();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      spans: Array<Record<string, unknown>>;
      sdkVersion: string;
    };
    expect(payload.sdkVersion).toBe("test/0.0.0");
    expect(payload.spans).toHaveLength(3);

    const agent = payload.spans.find((span) => span.kind === "agent");
    const llm = payload.spans.find((span) => span.kind === "llm");
    const tool = payload.spans.find((span) => span.kind === "tool");

    expect(agent?.traceId).toBe("run-123");
    expect(llm?.traceId).toBe("run-123");
    expect(tool?.traceId).toBe("run-123");
    expect(llm?.parentSpanId).toBe(agent?.spanId);
    expect(tool?.parentSpanId).toBe(agent?.spanId);
    expect(llm?.provider).toBe("openrouter");
    expect(llm?.model).toBe("anthropic/claude-sonnet-4-6");
    expect((llm?.usage as { totalTokens: number }).totalTokens).toBe(200);
    expect(tool?.toolName).toBe("exec_command");
  });

  it("emits custom session lifecycle spans", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const runtime = new ClawObsRuntime({
      config: createConfig(),
      logger: createLogger(),
    });

    runtime.start();
    runtime.onSessionStart(
      {
        sessionId: "session-2",
        sessionKey: "agent:main:session-2",
        resumedFrom: "session-1",
      },
      {
        sessionId: "session-2",
        sessionKey: "agent:main:session-2",
        agentId: "main",
      },
    );
    runtime.onSessionEnd(
      {
        sessionId: "session-2",
        sessionKey: "agent:main:session-2",
        messageCount: 7,
        durationMs: 1234,
        reason: "idle",
      },
      {
        sessionId: "session-2",
        sessionKey: "agent:main:session-2",
        agentId: "main",
      },
    );

    await runtime.stop();

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      spans: Array<Record<string, unknown>>;
    };
    expect(payload.spans).toHaveLength(2);
    expect(payload.spans.map((span) => span.name)).toEqual(["session.start", "session.end"]);
    expect(payload.spans.every((span) => span.kind === "custom")).toBe(true);
  });

  it("anchors message traces from before_dispatch and reuses them for llm-only runs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const runtime = new ClawObsRuntime({
      config: createConfig(),
      logger: createLogger(),
    });

    runtime.start();
    runtime.onBeforeDispatch(
      {
        content: "What is your height bro",
        channel: "telegram",
        sessionKey: "agent:main:telegram-session",
        senderId: "6342720482",
        timestamp: 1_776_519_000_000,
      },
      {
        channelId: "telegram",
        conversationId: "chat-1",
        sessionKey: "agent:main:telegram-session",
        senderId: "6342720482",
      },
    );
    runtime.onLlmInput(
      {
        runId: "run-height",
        sessionId: "telegram-session",
        provider: "openrouter",
        model: "minimax/m2.7",
        prompt: "What is your height bro",
        historyMessages: [],
        imagesCount: 0,
      },
      {
        runId: "run-height",
        sessionId: "telegram-session",
        sessionKey: "agent:main:telegram-session",
        channelId: "telegram",
        trigger: "message",
      },
    );
    runtime.onLlmOutput(
      {
        runId: "run-height",
        sessionId: "telegram-session",
        provider: "openrouter",
        model: "minimax/m2.7",
        assistantTexts: ["I'm an AI, I don't have a height."],
      },
      {
        runId: "run-height",
        sessionId: "telegram-session",
        sessionKey: "agent:main:telegram-session",
        channelId: "telegram",
        trigger: "message",
      },
    );
    runtime.onAgentEnd(
      {
        messages: [
          { role: "user", content: "What is your height bro" },
          { role: "assistant", content: "I'm an AI, I don't have a height." },
        ],
        success: true,
      },
      {
        runId: "run-height",
        sessionId: "telegram-session",
        sessionKey: "agent:main:telegram-session",
        channelId: "telegram",
        trigger: "message",
      },
    );

    await runtime.stop();

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      spans: Array<Record<string, unknown>>;
    };

    expect(payload.spans).toHaveLength(3);
    const traceIds = new Set(payload.spans.map((span) => span.traceId));
    expect(traceIds.size).toBe(1);
    expect(payload.spans.map((span) => span.name)).toEqual(
      expect.arrayContaining(["message.received", "agent.run"]),
    );
  });

  it("emits a standalone inbound message trace when no agent hooks follow", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const runtime = new ClawObsRuntime({
      config: createConfig(),
      logger: createLogger(),
    });

    runtime.start();
    runtime.onBeforeDispatch(
      {
        content: "hello from telegram",
        channel: "telegram",
        sessionKey: "agent:main:telegram-session",
        senderId: "user-1",
        timestamp: 1_776_519_100_000,
      },
      {
        channelId: "telegram",
        conversationId: "chat-1",
        sessionKey: "agent:main:telegram-session",
        senderId: "user-1",
      },
    );

    await runtime.stop();

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      spans: Array<Record<string, unknown>>;
    };
    expect(payload.spans).toHaveLength(1);
    expect(payload.spans[0]?.name).toBe("message.received");
    expect(payload.spans[0]?.kind).toBe("channel");
  });
});
