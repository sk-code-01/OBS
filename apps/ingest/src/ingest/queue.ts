import type { SpanRow } from "@clawobs/types";
import type { Writer } from "./writer.js";

/**
 * In-process async batch buffer.
 *
 * Spans are appended synchronously; the queue flushes when EITHER:
 *  - `maxSpans` rows have accumulated, OR
 *  - `maxMs` have passed since the first row of the current batch.
 *
 * Back-pressure: if queue depth exceeds `maxDepth`, further offers return
 * `false` and the HTTP layer should respond 429. A crashed process loses at
 * most one flush interval of data (acceptable trade-off for Phase 1).
 */
export interface Queue {
  /** Returns true if accepted, false if the queue is at capacity. */
  offer(rows: SpanRow[]): boolean;
  /** Flush remaining rows (used on shutdown or tests). */
  flush(): Promise<void>;
  close(): Promise<void>;
  /** Current buffer size — useful for tests and health endpoints. */
  depth(): number;
}

export interface QueueOptions {
  maxSpans: number;
  maxMs: number;
  maxDepth: number;
  onError?: (err: unknown, droppedRows: number) => void;
}

export function createQueue(writer: Writer, opts: QueueOptions): Queue {
  let buffer: SpanRow[] = [];
  let firstEnqueuedAt: number | null = null;
  let timer: NodeJS.Timeout | null = null;
  let closed = false;
  /** Number of flushes currently in-flight; included in depth for back-pressure. */
  let inflight = 0;

  const scheduleTimerFlush = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, opts.maxMs);
  };

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    firstEnqueuedAt = null;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    inflight += batch.length;
    try {
      await writer.write(batch);
    } catch (err) {
      opts.onError?.(err, batch.length);
    } finally {
      inflight -= batch.length;
    }
  };

  return {
    offer(rows: SpanRow[]): boolean {
      if (closed) return false;
      if (buffer.length + inflight + rows.length > opts.maxDepth) return false;

      if (firstEnqueuedAt === null) firstEnqueuedAt = Date.now();
      buffer.push(...rows);

      if (buffer.length >= opts.maxSpans) {
        void flush();
      } else {
        scheduleTimerFlush();
      }
      return true;
    },
    async flush(): Promise<void> {
      await flush();
    },
    async close(): Promise<void> {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await flush();
    },
    depth(): number {
      return buffer.length + inflight;
    },
  };
}
