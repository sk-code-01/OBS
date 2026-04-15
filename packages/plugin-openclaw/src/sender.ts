import type { IncomingSpan } from "@clawobs/types";
import type { PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import type { EnabledClawObsPluginConfig } from "./config.js";

interface SpanBatchSenderOptions {
  config: EnabledClawObsPluginConfig;
  logger: PluginLogger;
}

export class SpanBatchSender {
  private readonly config: EnabledClawObsPluginConfig;
  private readonly logger: PluginLogger;
  private readonly queue: IncomingSpan[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private inflight: Promise<void> | null = null;
  private droppedCount = 0;

  constructor(opts: SpanBatchSenderOptions) {
    this.config = opts.config;
    this.logger = opts.logger;
  }

  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.config.flushIntervalMs);
  }

  enqueue(span: IncomingSpan): boolean {
    if (this.queue.length >= this.config.maxQueueSize) {
      this.droppedCount += 1;
      if (this.droppedCount === 1 || this.droppedCount % 100 === 0) {
        this.logger.warn(
          `clawobs: queue full, dropped ${this.droppedCount} completed spans so far`,
        );
      }
      return false;
    }

    this.queue.push(span);
    if (this.queue.length >= this.config.flushAt) {
      void this.flush();
    }
    return true;
  }

  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flushAll();
  }

  async flushAll(): Promise<void> {
    for (let attempts = 0; attempts < 5 && this.queue.length > 0; attempts++) {
      await this.flush();
      if (this.inflight) await this.inflight;
      if (this.queue.length > 0) {
        await delay(250);
      }
    }
    if (this.queue.length > 0) {
      this.logger.warn(`clawobs: failed to flush ${this.queue.length} spans before shutdown`);
    }
  }

  async flush(): Promise<void> {
    if (this.inflight) {
      await this.inflight;
      return;
    }
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, Math.min(this.queue.length, 5_000));
    this.inflight = this.postBatch(batch)
      .catch((err) => {
        this.logger.warn(`clawobs: flush failed: ${formatError(err)}`);
      })
      .finally(() => {
        this.inflight = null;
        if (this.queue.length >= this.config.flushAt) {
          void this.flush();
        }
      });

    await this.inflight;
  }

  private async postBatch(batch: IncomingSpan[]): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const res = await fetch(`${this.config.ingestUrl}/v1/traces`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          sdkVersion: this.config.sdkVersion,
          spans: batch,
        }),
        signal: controller.signal,
      });

      if (res.ok) {
        return;
      }

      const body = await safeReadText(res);
      if (res.status === 401 || res.status === 403) {
        this.logger.error(
          `clawobs: auth failed for ingest (${res.status}); dropping ${batch.length} spans`,
        );
        return;
      }

      this.requeue(batch);
      this.logger.warn(
        `clawobs: ingest returned ${res.status}${body ? ` body=${body}` : ""}; will retry`,
      );
    } catch (err) {
      this.requeue(batch);
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  private requeue(batch: IncomingSpan[]): void {
    const next = batch.concat(this.queue);
    if (next.length <= this.config.maxQueueSize) {
      this.queue.splice(0, this.queue.length, ...next);
      return;
    }

    const kept = next.slice(0, this.config.maxQueueSize);
    const dropped = next.length - kept.length;
    this.queue.splice(0, this.queue.length, ...kept);
    this.droppedCount += dropped;
    this.logger.warn(
      `clawobs: retry queue exceeded max size, dropped ${dropped} oldest spans during requeue`,
    );
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return (await res.text()).trim().slice(0, 500);
  } catch {
    return "";
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
