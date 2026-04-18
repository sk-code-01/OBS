import { createHash, randomUUID } from "node:crypto";
import type { IncomingSpan } from "@clawobs/types";
import type { OpenClawPluginService, PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import type { ClawObsPluginConfig, EnabledClawObsPluginConfig } from "./config.js";
import { isClawObsEnabled } from "./config.js";
import { sanitizeForTelemetry } from "./sanitize.js";
import { SpanBatchSender } from "./sender.js";

interface ClawObsRuntimeOptions {
  config: ClawObsPluginConfig;
  logger: PluginLogger;
}

interface AgentHookContext {
  runId?: string;
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  modelProviderId?: string;
  modelId?: string;
  messageProvider?: string;
  trigger?: string;
  channelId?: string;
}

interface BeforeAgentStartEvent {
  prompt: string;
  messages?: unknown[];
}

interface LlmInputEvent {
  runId: string;
  sessionId: string;
  provider: string;
  model: string;
  systemPrompt?: string;
  prompt: string;
  historyMessages: unknown[];
  imagesCount: number;
}

interface LlmOutputEvent {
  runId: string;
  sessionId: string;
  provider: string;
  model: string;
  assistantTexts: string[];
  lastAssistant?: unknown;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
}

interface AgentEndEvent {
  messages: unknown[];
  success: boolean;
  error?: string;
  durationMs?: number;
}

interface ToolHookContext {
  toolName: string;
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  toolCallId?: string;
}

interface BeforeToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
  runId?: string;
  toolCallId?: string;
}

interface AfterToolCallEvent extends BeforeToolCallEvent {
  result?: unknown;
  error?: string;
  durationMs?: number;
}

interface SessionHookContext {
  agentId?: string;
  sessionId: string;
  sessionKey?: string;
}

interface SessionStartEvent {
  sessionId: string;
  sessionKey?: string;
  resumedFrom?: string;
}

interface SessionEndEvent {
  sessionId: string;
  sessionKey?: string;
  messageCount: number;
  durationMs?: number;
  reason?: string;
  sessionFile?: string;
  transcriptArchived?: boolean;
  nextSessionId?: string;
  nextSessionKey?: string;
}

interface BeforeDispatchEvent {
  content: string;
  body?: string;
  channel?: string;
  sessionKey?: string;
  senderId?: string;
  isGroup?: boolean;
  timestamp?: number;
}

interface BeforeDispatchContext {
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  sessionKey?: string;
  senderId?: string;
}

interface PendingInboundTurn {
  traceId: string;
  sessionKey: string;
  startTime: string;
  content: string;
  metadata: Record<string, unknown>;
}

interface ActiveAgentRun {
  traceId: string;
  spanId: string;
  sessionId?: string;
  agentId?: string;
  startTime: string;
  input?: unknown;
  metadata: Record<string, unknown>;
}

interface ActiveLlmCall {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sessionId?: string;
  agentId?: string;
  startTime: string;
  provider?: string;
  model?: string;
  input?: unknown;
  metadata: Record<string, unknown>;
}

interface ActiveToolCall {
  key: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sessionId?: string;
  agentId?: string;
  startTime: string;
  toolName: string;
  toolCallId?: string;
  input?: unknown;
  metadata: Record<string, unknown>;
}

export class ClawObsRuntime {
  private readonly config: ClawObsPluginConfig;
  private readonly enabledConfig: EnabledClawObsPluginConfig | null;
  private readonly logger: PluginLogger;
  private readonly sender: SpanBatchSender | null;
  private readonly sampledRuns = new Map<string, boolean>();
  private readonly activeAgents = new Map<string, ActiveAgentRun>();
  private readonly activeLlms = new Map<string, ActiveLlmCall[]>();
  private readonly activeToolsById = new Map<string, ActiveToolCall>();
  private readonly activeToolsByRun = new Map<string, ActiveToolCall[]>();
  private readonly pendingInboundTurns = new Map<string, PendingInboundTurn[]>();
  private started = false;
  private disabledWarned = false;

  constructor(opts: ClawObsRuntimeOptions) {
    this.config = opts.config;
    this.logger = opts.logger;
    this.enabledConfig = isClawObsEnabled(opts.config) ? opts.config : null;
    this.sender = this.enabledConfig
      ? new SpanBatchSender({
          config: this.enabledConfig,
          logger: opts.logger,
        })
      : null;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (!this.sender) {
      this.warnDisabled();
      return;
    }
    this.sender.start();
    this.logger.info(`clawobs: tracing enabled -> ${this.enabledConfig!.ingestUrl}`);
  }

  async stop(): Promise<void> {
    if (!this.sender) return;
    this.closeActiveSpans("plugin_stopped", "ClawObs plugin stopped before span completed");
    await this.sender.stop();
  }

  onBeforeAgentStart(event: BeforeAgentStartEvent, ctx: AgentHookContext): void {
    const runKey = resolveRunKey(ctx);
    if (!runKey || !this.shouldTrackRun(runKey)) return;
    const agent = this.ensureAgentRun(runKey, ctx);
    agent.metadata = {
      ...agent.metadata,
      ...buildRunMetadata(ctx),
    };
    agent.input = this.config.captureInputs
      ? sanitizeForTelemetry(
          this.config.captureMessages
            ? { prompt: event.prompt, messages: event.messages }
            : { prompt: event.prompt },
        )
      : undefined;
  }

  onBeforeDispatch(event: BeforeDispatchEvent, ctx: BeforeDispatchContext): void {
    if (!this.sender) return;

    const content = event.content.trim();
    if (!content || isInternalDispatchContent(content)) return;

    const sessionKey = event.sessionKey?.trim() || ctx.sessionKey?.trim();
    const startTime = isoFromEventTimestamp(event.timestamp) ?? nowIso();
    const metadata = buildDispatchMetadata(event, ctx);
    const pending: PendingInboundTurn | null = sessionKey
      ? {
          traceId: traceIdFromDispatch(sessionKey, event.timestamp, content),
          sessionKey,
          startTime,
          content,
          metadata,
        }
      : null;

    if (pending) {
      const queue = this.pendingInboundTurns.get(pending.sessionKey) ?? [];
      queue.push(pending);
      this.pendingInboundTurns.set(pending.sessionKey, queue);
    }

    this.emitSpan({
      traceId: pending?.traceId ?? traceIdFromDispatch(ctx.channelId ?? "channel", event.timestamp, content),
      spanId: makeSpanId(),
      kind: "channel",
      name: "message.received",
      status: "ok",
      startTime,
      endTime: startTime,
      input: this.config.captureInputs
        ? sanitizeForTelemetry({
            prompt: content,
            timestamp: startTime,
          })
        : undefined,
      metadata,
    });
  }

  onLlmInput(event: LlmInputEvent, ctx: AgentHookContext): void {
    const runKey = event.runId || resolveRunKey(ctx);
    if (!runKey || !this.shouldTrackRun(runKey)) return;

    const agent = this.ensureAgentRun(runKey, ctx);
    const queue = this.activeLlms.get(runKey) ?? [];
    queue.push({
      traceId: agent.traceId,
      spanId: makeSpanId(),
      parentSpanId: agent.spanId,
      sessionId: agent.sessionId,
      agentId: agent.agentId,
      startTime: nowIso(),
      provider: normalizeProvider(event.provider),
      model: event.model?.trim() || undefined,
      input: this.config.captureInputs
        ? sanitizeForTelemetry(
            this.config.captureMessages
              ? {
                  systemPrompt: event.systemPrompt,
                  prompt: event.prompt,
                  historyMessages: event.historyMessages,
                  imagesCount: event.imagesCount,
                }
              : {
                  systemPrompt: event.systemPrompt,
                  prompt: event.prompt,
                  imagesCount: event.imagesCount,
                },
          )
        : undefined,
      metadata: {
        ...buildRunMetadata(ctx),
        historyMessageCount: event.historyMessages.length,
        imagesCount: event.imagesCount,
      },
    });
    this.activeLlms.set(runKey, queue);
  }

  onLlmOutput(event: LlmOutputEvent, ctx: AgentHookContext): void {
    const runKey = event.runId || resolveRunKey(ctx);
    if (!runKey || !this.shouldTrackRun(runKey)) return;

    const pending = this.activeLlms.get(runKey) ?? [];
    const active = pending.shift();
    if (pending.length > 0) this.activeLlms.set(runKey, pending);
    else this.activeLlms.delete(runKey);

    const endedAt = nowIso();
    const agent = active ? null : this.ensureAgentRun(runKey, ctx);
    const llmCall = active ?? {
      traceId: agent!.traceId,
      spanId: makeSpanId(),
      parentSpanId: agent!.spanId,
      sessionId: agent!.sessionId,
      agentId: agent!.agentId,
      startTime: endedAt,
      provider: normalizeProvider(event.provider),
      model: event.model?.trim() || undefined,
      input: undefined,
      metadata: buildRunMetadata(ctx),
    };

    this.emitSpan({
      traceId: llmCall.traceId,
      spanId: llmCall.spanId,
      parentSpanId: llmCall.parentSpanId,
      sessionId: llmCall.sessionId,
      agentId: llmCall.agentId,
      kind: "llm",
      name: `llm:${event.provider}/${event.model}`,
      status: "ok",
      startTime: llmCall.startTime,
      endTime: endedAt,
      provider: normalizeProvider(event.provider),
      model: event.model?.trim() || undefined,
      usage: {
        inputTokens: event.usage?.input,
        outputTokens: event.usage?.output,
        totalTokens: event.usage?.total,
      },
      input: llmCall.input,
      output: this.config.captureOutputs
        ? sanitizeForTelemetry(
            this.config.captureMessages
              ? {
                  assistantTexts: event.assistantTexts,
                  lastAssistant: event.lastAssistant,
                }
              : { assistantTexts: event.assistantTexts },
          )
        : undefined,
      metadata: {
        ...llmCall.metadata,
        assistantTextCount: event.assistantTexts.length,
        cacheReadTokens: event.usage?.cacheRead,
        cacheWriteTokens: event.usage?.cacheWrite,
      },
    });
  }

  onBeforeToolCall(event: BeforeToolCallEvent, ctx: ToolHookContext): void {
    const runKey = event.runId || ctx.runId;
    if (!runKey || !this.shouldTrackRun(runKey)) return;

    const agent = this.ensureAgentRun(runKey, ctx);
    const active: ActiveToolCall = {
      key: toolKey(runKey, event.toolCallId),
      traceId: agent.traceId,
      spanId: makeSpanId(),
      parentSpanId: agent.spanId,
      sessionId: agent.sessionId,
      agentId: agent.agentId,
      startTime: nowIso(),
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      input: this.config.captureInputs ? sanitizeForTelemetry(event.params) : undefined,
      metadata: {
        ...buildToolMetadata(ctx),
        toolCallId: event.toolCallId,
      },
    };

    if (event.toolCallId) {
      this.activeToolsById.set(active.key, active);
      return;
    }

    const queue = this.activeToolsByRun.get(runKey) ?? [];
    queue.push(active);
    this.activeToolsByRun.set(runKey, queue);
  }

  onAfterToolCall(event: AfterToolCallEvent, ctx: ToolHookContext): void {
    const runKey = event.runId || ctx.runId;
    if (!runKey || !this.shouldTrackRun(runKey)) return;

    const active = this.takeToolCall(runKey, event.toolCallId);
    const endedAt = nowIso();
    const syntheticStart = isoFromDuration(event.durationMs, endedAt);
    const agent = active ? null : this.ensureAgentRun(runKey, ctx, syntheticStart);
    const toolCall = active ?? {
      key: toolKey(runKey, event.toolCallId),
      traceId: agent!.traceId,
      spanId: makeSpanId(),
      parentSpanId: agent!.spanId,
      sessionId: agent!.sessionId,
      agentId: agent!.agentId,
      startTime: syntheticStart,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      input: undefined,
      metadata: buildToolMetadata(ctx),
    };

    this.emitSpan({
      traceId: toolCall.traceId,
      spanId: toolCall.spanId,
      parentSpanId: toolCall.parentSpanId,
      sessionId: toolCall.sessionId,
      agentId: toolCall.agentId,
      kind: "tool",
      name: `tool:${event.toolName}`,
      status: event.error ? "error" : "ok",
      startTime: toolCall.startTime,
      endTime: endedAt,
      toolName: event.toolName,
      input: toolCall.input,
      output: this.config.captureOutputs ? sanitizeForTelemetry(event.result) : undefined,
      metadata: {
        ...toolCall.metadata,
        durationMs: event.durationMs,
      },
      error: event.error ? { message: event.error } : undefined,
    });
  }

  onAgentEnd(event: AgentEndEvent, ctx: AgentHookContext): void {
    const runKey = resolveRunKey(ctx);
    if (!runKey || !this.shouldTrackRun(runKey)) return;

    const endedAt = nowIso();
    const syntheticStart = isoFromDuration(event.durationMs, endedAt);
    const agent = this.ensureAgentRun(runKey, ctx, syntheticStart);

    this.closeDanglingLlmCalls(
      runKey,
      endedAt,
      event.error || "Agent run ended before llm_output completed",
    );
    this.closeDanglingToolCalls(
      runKey,
      endedAt,
      event.error || "Agent run ended before after_tool_call completed",
    );

    this.emitSpan({
      traceId: agent.traceId,
      spanId: agent.spanId,
      sessionId: agent.sessionId,
      agentId: agent.agentId,
      kind: "agent",
      name: "agent.run",
      status: event.success ? "ok" : "error",
      startTime: agent.startTime,
      endTime: endedAt,
      input: agent.input,
      output:
        this.config.captureOutputs && this.config.captureMessages
          ? sanitizeForTelemetry({ messages: event.messages })
          : undefined,
      metadata: {
        ...agent.metadata,
        durationMs: event.durationMs,
        messageCount: event.messages.length,
      },
      error: event.error ? { message: event.error } : undefined,
    });

    this.activeAgents.delete(runKey);
    this.sampledRuns.delete(runKey);
  }

  onSessionStart(event: SessionStartEvent, ctx: SessionHookContext): void {
    if (!this.sender) return;

    const sessionId = normalizeId(event.sessionId || ctx.sessionId, "session");
    if (!sessionId) return;

    const now = nowIso();
    this.emitSpan({
      traceId: traceIdFromSession(sessionId),
      spanId: makeSpanId(),
      sessionId,
      agentId: normalizeId(ctx.agentId, "agent"),
      kind: "custom",
      name: "session.start",
      status: "ok",
      startTime: now,
      endTime: now,
      metadata: sanitizeForTelemetry({
        source: "openclaw",
        sessionKey: event.sessionKey ?? ctx.sessionKey,
        resumedFrom: event.resumedFrom,
      }) as Record<string, unknown>,
    });
  }

  onSessionEnd(event: SessionEndEvent, ctx: SessionHookContext): void {
    if (!this.sender) return;

    const sessionId = normalizeId(event.sessionId || ctx.sessionId, "session");
    if (!sessionId) return;

    const now = nowIso();
    this.emitSpan({
      traceId: traceIdFromSession(sessionId),
      spanId: makeSpanId(),
      sessionId,
      agentId: normalizeId(ctx.agentId, "agent"),
      kind: "custom",
      name: "session.end",
      status: "ok",
      startTime: now,
      endTime: now,
      metadata: sanitizeForTelemetry({
        source: "openclaw",
        sessionKey: event.sessionKey ?? ctx.sessionKey,
        messageCount: event.messageCount,
        durationMs: event.durationMs,
        reason: event.reason,
        sessionFile: event.sessionFile,
        transcriptArchived: event.transcriptArchived,
        nextSessionId: event.nextSessionId,
        nextSessionKey: event.nextSessionKey,
      }) as Record<string, unknown>,
    });
  }

  private ensureAgentRun(
    runKey: string,
    ctx: Pick<
      AgentHookContext,
      | "agentId"
      | "sessionId"
      | "sessionKey"
      | "workspaceDir"
      | "trigger"
      | "channelId"
      | "messageProvider"
      | "modelProviderId"
      | "modelId"
    >,
    startTime = nowIso(),
  ): ActiveAgentRun {
    const existing = this.activeAgents.get(runKey);
    if (existing) return existing;

    const pendingInbound =
      ctx.sessionKey ? this.takePendingInboundTurn(ctx.sessionKey) : undefined;

    const created: ActiveAgentRun = {
      traceId: pendingInbound?.traceId ?? traceIdFromRun(runKey),
      spanId: makeSpanId(),
      sessionId: normalizeId(ctx.sessionId, "session"),
      agentId: normalizeId(ctx.agentId, "agent"),
      startTime: pendingInbound?.startTime ?? startTime,
      input:
        pendingInbound && this.config.captureInputs && !this.config.captureMessages
          ? sanitizeForTelemetry({ prompt: pendingInbound.content })
          : undefined,
      metadata: {
        ...pendingInbound?.metadata,
        ...buildRunMetadata(ctx),
      },
    };
    this.activeAgents.set(runKey, created);
    return created;
  }

  private takePendingInboundTurn(sessionKey: string): PendingInboundTurn | undefined {
    const key = sessionKey.trim();
    if (!key) return undefined;
    const queue = this.pendingInboundTurns.get(key) ?? [];
    const pending = queue.shift();
    if (queue.length > 0) this.pendingInboundTurns.set(key, queue);
    else this.pendingInboundTurns.delete(key);
    return pending;
  }

  private takeToolCall(runKey: string, toolCallId?: string): ActiveToolCall | undefined {
    if (toolCallId) {
      const key = toolKey(runKey, toolCallId);
      const active = this.activeToolsById.get(key);
      if (active) this.activeToolsById.delete(key);
      return active;
    }

    const queue = this.activeToolsByRun.get(runKey) ?? [];
    const active = queue.shift();
    if (queue.length > 0) this.activeToolsByRun.set(runKey, queue);
    else this.activeToolsByRun.delete(runKey);
    return active;
  }

  private closeDanglingLlmCalls(runKey: string, endedAt: string, message: string): void {
    const pending = this.activeLlms.get(runKey) ?? [];
    this.activeLlms.delete(runKey);
    for (const llmCall of pending) {
      this.emitSpan({
        traceId: llmCall.traceId,
        spanId: llmCall.spanId,
        parentSpanId: llmCall.parentSpanId,
        sessionId: llmCall.sessionId,
        agentId: llmCall.agentId,
        kind: "llm",
        name: `llm:${llmCall.provider ?? "unknown"}/${llmCall.model ?? "unknown"}`,
        status: "error",
        startTime: llmCall.startTime,
        endTime: endedAt,
        provider: llmCall.provider,
        model: llmCall.model,
        input: llmCall.input,
        metadata: llmCall.metadata,
        error: { message },
      });
    }
  }

  private closeDanglingToolCalls(runKey: string, endedAt: string, message: string): void {
    const byRun = this.activeToolsByRun.get(runKey) ?? [];
    this.activeToolsByRun.delete(runKey);
    for (const toolCall of byRun) {
      this.emitSpan({
        traceId: toolCall.traceId,
        spanId: toolCall.spanId,
        parentSpanId: toolCall.parentSpanId,
        sessionId: toolCall.sessionId,
        agentId: toolCall.agentId,
        kind: "tool",
        name: `tool:${toolCall.toolName}`,
        status: "error",
        startTime: toolCall.startTime,
        endTime: endedAt,
        toolName: toolCall.toolName,
        input: toolCall.input,
        metadata: toolCall.metadata,
        error: { message },
      });
    }

    for (const [key, toolCall] of Array.from(this.activeToolsById.entries())) {
      if (!key.startsWith(`${runKey}:`)) continue;
      this.activeToolsById.delete(key);
      this.emitSpan({
        traceId: toolCall.traceId,
        spanId: toolCall.spanId,
        parentSpanId: toolCall.parentSpanId,
        sessionId: toolCall.sessionId,
        agentId: toolCall.agentId,
        kind: "tool",
        name: `tool:${toolCall.toolName}`,
        status: "error",
        startTime: toolCall.startTime,
        endTime: endedAt,
        toolName: toolCall.toolName,
        input: toolCall.input,
        metadata: toolCall.metadata,
        error: { message },
      });
    }
  }

  private closeActiveSpans(reason: string, errorMessage: string): void {
    const endedAt = nowIso();
    for (const runKey of Array.from(this.activeAgents.keys())) {
      this.closeDanglingLlmCalls(runKey, endedAt, errorMessage);
      this.closeDanglingToolCalls(runKey, endedAt, errorMessage);

      const agent = this.activeAgents.get(runKey);
      if (!agent) continue;
      this.emitSpan({
        traceId: agent.traceId,
        spanId: agent.spanId,
        sessionId: agent.sessionId,
        agentId: agent.agentId,
        kind: "agent",
        name: "agent.run",
        status: "error",
        startTime: agent.startTime,
        endTime: endedAt,
        input: agent.input,
        metadata: {
          ...agent.metadata,
          shutdownReason: reason,
        },
        error: { message: errorMessage },
      });
    }

    this.activeAgents.clear();
    this.sampledRuns.clear();
  }

  private emitSpan(span: IncomingSpan): void {
    if (!this.sender) return;
    this.sender.enqueue(span);
  }

  private shouldTrackRun(runKey: string): boolean {
    if (!this.sender) return false;
    const existing = this.sampledRuns.get(runKey);
    if (existing != null) return existing;
    const sampled = this.config.sampleRate >= 1 || Math.random() <= this.config.sampleRate;
    this.sampledRuns.set(runKey, sampled);
    return sampled;
  }

  private warnDisabled(): void {
    if (this.disabledWarned) return;
    this.disabledWarned = true;
    this.logger.warn(
      "clawobs: tracing disabled because ingestUrl/apiKey are missing; set CLAWOBS_INGEST_URL and CLAWOBS_API_KEY or configure plugins.entries.clawobs.config",
    );
  }
}

export function createClawObsService(runtime: ClawObsRuntime): OpenClawPluginService {
  return {
    id: "clawobs",
    start() {
      runtime.start();
    },
    async stop() {
      await runtime.stop();
    },
  };
}

function buildRunMetadata(
  ctx: Pick<
    AgentHookContext,
    | "sessionKey"
    | "workspaceDir"
    | "trigger"
    | "channelId"
    | "messageProvider"
    | "modelProviderId"
    | "modelId"
  >,
): Record<string, unknown> {
  return sanitizeForTelemetry(
    compactObject({
      source: "openclaw",
      sessionKey: ctx.sessionKey,
      workspaceDir: ctx.workspaceDir,
      trigger: ctx.trigger,
      channelId: ctx.channelId,
      messageProvider: ctx.messageProvider,
      modelProviderId: ctx.modelProviderId,
      modelId: ctx.modelId,
    }),
  ) as Record<string, unknown>;
}

function buildToolMetadata(ctx: {
  sessionKey?: string;
  toolCallId?: string;
}): Record<string, unknown> {
  return sanitizeForTelemetry(
    compactObject({
      source: "openclaw",
      sessionKey: ctx.sessionKey,
      toolCallId: ctx.toolCallId,
    }),
  ) as Record<string, unknown>;
}

function buildDispatchMetadata(
  event: BeforeDispatchEvent,
  ctx: BeforeDispatchContext,
): Record<string, unknown> {
  return sanitizeForTelemetry(
    compactObject({
      source: "openclaw",
      origin: "before_dispatch",
      channel: event.channel,
      channelId: ctx.channelId,
      accountId: ctx.accountId,
      conversationId: ctx.conversationId,
      sessionKey: event.sessionKey ?? ctx.sessionKey,
      senderId: event.senderId ?? ctx.senderId,
      isGroup: event.isGroup,
      timestamp: isoFromEventTimestamp(event.timestamp),
    }),
  ) as Record<string, unknown>;
}

function compactObject(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}

function resolveRunKey(ctx: Pick<AgentHookContext, "runId">): string | undefined {
  return ctx.runId?.trim() || undefined;
}

function toolKey(runKey: string, toolCallId?: string): string {
  return `${runKey}:${toolCallId ?? randomUUID()}`;
}

function makeSpanId(): string {
  return `span_${randomUUID().replaceAll("-", "")}`;
}

function traceIdFromRun(runId: string): string {
  return normalizeId(runId, "trace") ?? `trace_${digest(runId)}`;
}

function traceIdFromSession(sessionId: string): string {
  return normalizeId(`session:${sessionId}`, "session-trace") ?? `session_${digest(sessionId)}`;
}

function traceIdFromDispatch(sessionKey: string, timestamp: number | undefined, content: string): string {
  return `msg_${digest(`${sessionKey}:${timestamp ?? ""}:${content}`)}`;
}

function normalizeId(value: string | undefined, prefix: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= 120) return trimmed;
  return `${prefix}_${digest(trimmed)}`;
}

function normalizeProvider(provider: string | undefined): string | undefined {
  const trimmed = provider?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}

function digest(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

function isoFromEventTimestamp(timestamp: number | undefined): string | undefined {
  if (!Number.isFinite(timestamp)) return undefined;
  const normalized =
    timestamp! > 1_000_000_000_000 ? timestamp! : timestamp! > 1_000_000_000 ? timestamp! * 1_000 : NaN;
  if (!Number.isFinite(normalized)) return undefined;
  return new Date(normalized).toISOString();
}

function isInternalDispatchContent(content: string): boolean {
  return content.trim().startsWith("Read HEARTBEAT.md if it exists");
}

function isoFromDuration(durationMs: number | undefined, endIso: string): string {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs <= 0) {
    return endIso;
  }
  const end = new Date(endIso).getTime();
  return new Date(end - Math.max(0, Math.floor(durationMs))).toISOString();
}
