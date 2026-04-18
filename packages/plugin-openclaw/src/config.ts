export interface ClawObsPluginConfig {
  ingestUrl?: string;
  apiKey?: string;
  sdkVersion: string;
  flushAt: number;
  flushIntervalMs: number;
  requestTimeoutMs: number;
  maxQueueSize: number;
  captureInputs: boolean;
  captureOutputs: boolean;
  captureMessages: boolean;
  sampleRate: number;
}

export interface EnabledClawObsPluginConfig extends ClawObsPluginConfig {
  ingestUrl: string;
  apiKey: string;
}

export const DEFAULT_SDK_VERSION = "clawobs-openclaw/0.1.2";

function readString(
  source: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = source?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(
  source: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(
  source: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const value = source?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function readEnvNumber(env: NodeJS.ProcessEnv, key: string): number | undefined {
  const raw = env[key];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function readEnvBoolean(env: NodeJS.ProcessEnv, key: string): boolean | undefined {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) return undefined;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return undefined;
}

function clampInt(value: number | undefined, fallback: number, min: number): number {
  if (value == null) return fallback;
  return Math.max(min, Math.floor(value));
}

function clampRate(value: number | undefined, fallback: number): number {
  if (value == null || Number.isNaN(value)) return fallback;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function resolveClawObsPluginConfig(
  pluginConfig: Record<string, unknown> | undefined,
  env: NodeJS.ProcessEnv = process.env,
  defaultSdkVersion = DEFAULT_SDK_VERSION,
): ClawObsPluginConfig {
  const ingestUrl =
    readString(pluginConfig, "ingestUrl") ?? env.CLAWOBS_INGEST_URL?.trim() ?? undefined;
  const apiKey = readString(pluginConfig, "apiKey") ?? env.CLAWOBS_API_KEY?.trim() ?? undefined;
  const sdkVersion =
    readString(pluginConfig, "sdkVersion") ??
    env.CLAWOBS_SDK_VERSION?.trim() ??
    defaultSdkVersion;

  const flushAt = clampInt(
    readNumber(pluginConfig, "flushAt") ?? readEnvNumber(env, "CLAWOBS_FLUSH_AT"),
    25,
    1,
  );
  const flushIntervalMs = clampInt(
    readNumber(pluginConfig, "flushIntervalMs") ??
      readEnvNumber(env, "CLAWOBS_FLUSH_INTERVAL_MS"),
    1_000,
    100,
  );
  const requestTimeoutMs = clampInt(
    readNumber(pluginConfig, "requestTimeoutMs") ??
      readEnvNumber(env, "CLAWOBS_REQUEST_TIMEOUT_MS"),
    10_000,
    500,
  );
  const maxQueueSize = clampInt(
    readNumber(pluginConfig, "maxQueueSize") ?? readEnvNumber(env, "CLAWOBS_MAX_QUEUE_SIZE"),
    10_000,
    1,
  );
  const sampleRate = clampRate(
    readNumber(pluginConfig, "sampleRate") ?? readEnvNumber(env, "CLAWOBS_SAMPLE_RATE"),
    1,
  );

  return {
    ingestUrl: ingestUrl?.replace(/\/+$/, ""),
    apiKey,
    sdkVersion,
    flushAt,
    flushIntervalMs,
    requestTimeoutMs,
    maxQueueSize,
    captureInputs:
      readBoolean(pluginConfig, "captureInputs") ??
      readEnvBoolean(env, "CLAWOBS_CAPTURE_INPUTS") ??
      true,
    captureOutputs:
      readBoolean(pluginConfig, "captureOutputs") ??
      readEnvBoolean(env, "CLAWOBS_CAPTURE_OUTPUTS") ??
      true,
    captureMessages:
      readBoolean(pluginConfig, "captureMessages") ??
      readEnvBoolean(env, "CLAWOBS_CAPTURE_MESSAGES") ??
      false,
    sampleRate,
  };
}

export function isClawObsEnabled(
  config: ClawObsPluginConfig,
): config is EnabledClawObsPluginConfig {
  return Boolean(config.ingestUrl && config.apiKey);
}
