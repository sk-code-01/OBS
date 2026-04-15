/**
 * CLI wrapper: `pnpm -F @clawobs/clickhouse-schema migrate`.
 *
 * Reads connection info from env and applies all migrations.
 */
import { migrate } from "./index.js";

const url = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const database = process.env.CLICKHOUSE_DB ?? "clawobs";
const username = process.env.CLICKHOUSE_USER;
const password = process.env.CLICKHOUSE_PASSWORD;

migrate({ url, database, username, password })
  .then(() => {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(`migrations complete (db=${database})`);
    process.exit(0);
  })
  .catch((err) => {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error("migration failed:", err);
    process.exit(1);
  });
