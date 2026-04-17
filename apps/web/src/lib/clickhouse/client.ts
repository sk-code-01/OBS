import { createAppClient } from "@clawobs/clickhouse-schema";
import type { ClickHouseClient } from "@clickhouse/client";
import { getConfig } from "@/lib/config";

declare global {
  // eslint-disable-next-line no-var
  var __clawobsClickHouseClient: ClickHouseClient | undefined;
}

export function getClickhouse(): ClickHouseClient {
  if (globalThis.__clawobsClickHouseClient) return globalThis.__clawobsClickHouseClient;

  const config = getConfig();
  const client = createAppClient({
    url: config.CLICKHOUSE_URL,
    database: config.CLICKHOUSE_DB,
    username: config.CLICKHOUSE_USER,
    password: config.CLICKHOUSE_PASSWORD,
  });

  if (process.env.NODE_ENV !== "production") {
    globalThis.__clawobsClickHouseClient = client;
  }

  return client;
}

export const clickhouse = new Proxy({} as ClickHouseClient, {
  get(_target, prop, receiver) {
    const value = Reflect.get(getClickhouse(), prop, receiver);
    return typeof value === "function" ? value.bind(getClickhouse()) : value;
  },
});
