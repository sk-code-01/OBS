/**
 * Model pricing in USD per 1K tokens.
 *
 * This is a convenience table: the SDK can also pre-compute cost. Keep it
 * short — exact per-model pricing drifts and is better supplied by the SDK
 * for less-common models. Unknown models return `null` (we store NULL).
 */
interface ModelPricing {
  /** USD per 1K input tokens. */
  input: number;
  /** USD per 1K output tokens. */
  output: number;
}

const PRICING: Record<string, ModelPricing> = {
  // Anthropic (indicative; keep a narrow built-in set)
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  // Google
  "gemini-1.5-pro": { input: 1.25, output: 5 },
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },
};

export function estimateCostUsd(
  model: string | undefined,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): number | null {
  if (!model) return null;
  const p = PRICING[model];
  if (!p) return null;
  const inCost = ((inputTokens ?? 0) / 1000) * p.input;
  const outCost = ((outputTokens ?? 0) / 1000) * p.output;
  return Number((inCost + outCost).toFixed(8));
}
