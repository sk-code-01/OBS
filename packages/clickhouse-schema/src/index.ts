import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ClickHouseClient, createClient } from "@clickhouse/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "..", "migrations");

export interface MigrateOptions {
  url: string;
  database: string;
  username?: string;
  password?: string;
}

/**
 * Apply every SQL file in `migrations/` in lexical order.
 *
 * Statements in each file are separated by lines containing `-- @@`
 * (the ClickHouse HTTP interface accepts one statement per request).
 * The token `__DB__` is replaced with the target database name.
 *
 * All migrations use `IF NOT EXISTS` so re-running is a no-op.
 */
export async function migrate(opts: MigrateOptions): Promise<void> {
  // Connect without a default database so we can create it.
  const bootstrap = createClient({
    url: opts.url,
    username: opts.username,
    password: opts.password,
  });

  try {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      const statements = splitStatements(sql, opts.database);

      for (const stmt of statements) {
        await bootstrap.command({ query: stmt });
      }
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.log(`applied ${file} (${statements.length} statements)`);
    }
  } finally {
    await bootstrap.close();
  }
}

function splitStatements(sql: string, database: string): string[] {
  return sql
    .split(/^--\s*@@\s*$/m)
    .map((s) => s.replaceAll("__DB__", database).trim())
    .filter((s) => s.length > 0 && !s.split("\n").every((l) => l.trim().startsWith("--")));
}

/** Construct a configured client for application use (after `migrate`). */
export function createAppClient(opts: MigrateOptions): ClickHouseClient {
  return createClient({
    url: opts.url,
    database: opts.database,
    username: opts.username,
    password: opts.password,
    clickhouse_settings: {
      // Durable async inserts: ClickHouse buffers and flushes on a schedule.
      async_insert: 1,
      wait_for_async_insert: 1,
    },
  });
}
