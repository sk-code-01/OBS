import { z } from "zod";

export const SpanKindSchema = z.enum(["agent", "llm", "tool", "channel", "custom"]);
export const SpanStatusSchema = z.enum(["ok", "error", "in_progress"]);
export const ProviderSchema = z.string().min(1).max(128);

export const TokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
});

export const SpanCostSchema = z.object({
  usd: z.number().nonnegative(),
});

export const SpanErrorSchema = z.object({
  message: z.string(),
  stack: z.string().optional(),
});

export const IncomingSpanSchema = z.object({
  traceId: z.string().min(1).max(128),
  spanId: z.string().min(1).max(128),
  parentSpanId: z.string().min(1).max(128).optional(),
  sessionId: z.string().min(1).max(128).optional(),
  agentId: z.string().min(1).max(128).optional(),

  kind: SpanKindSchema,
  name: z.string().min(1).max(256),
  status: SpanStatusSchema,

  startTime: z.string().min(1), // ISO-8601
  endTime: z.string().min(1).optional(),

  provider: ProviderSchema.optional(),
  model: z.string().max(128).optional(),
  usage: TokenUsageSchema.optional(),
  cost: SpanCostSchema.optional(),

  toolName: z.string().max(128).optional(),

  input: z.unknown().optional(),
  output: z.unknown().optional(),
  metadata: z.record(z.unknown()).optional(),
  error: SpanErrorSchema.optional(),
});

export const TraceBatchSchema = z.object({
  sdkVersion: z.string().min(1).max(64),
  spans: z.array(IncomingSpanSchema).min(1).max(5000),
});

export const SingleEventSchema = IncomingSpanSchema.extend({
  sdkVersion: z.string().min(1).max(64),
});

export type TraceBatchInput = z.infer<typeof TraceBatchSchema>;
export type IncomingSpanInput = z.infer<typeof IncomingSpanSchema>;
