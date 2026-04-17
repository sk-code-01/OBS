import { migrate } from "@clawobs/clickhouse-schema";

const url = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const database = process.env.CLICKHOUSE_DB ?? "clawobs";
const username = process.env.CLICKHOUSE_USER;
const password = process.env.CLICKHOUSE_PASSWORD;

migrate({ url, database, username, password })
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    // biome-ignore lint/suspicious/noConsole: deploy-time migration failure
    console.error("migration failed:", err);
    process.exit(1);
  });
