import type { ClickHouseClient } from "@clickhouse/client";
import type { SpanRow } from "@clawobs/types";

/**
 * Batch-insert span rows. Uses ClickHouse's native JSONEachRow format so we
 * can send an arbitrary-sized batch in one request.
 *
 * The client is configured with `async_insert=1, wait_for_async_insert=1`
 * so ClickHouse absorbs micro-batches internally — very tolerant of our
 * own variable flush sizes.
 */
export interface Writer {
  write(rows: SpanRow[]): Promise<void>;
}

export function createWriter(client: ClickHouseClient): Writer {
  return {
    async write(rows: SpanRow[]): Promise<void> {
      if (rows.length === 0) return;
      await client.insert({
        table: "spans",
        values: rows,
        format: "JSONEachRow",
      });
    },
  };
}
