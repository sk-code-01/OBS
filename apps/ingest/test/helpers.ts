import { randomUUID } from "node:crypto";
import { createAppClient, migrate } from "@clawobs/clickhouse-schema";
import type { ClickHouseClient } from "@clickhouse/client";
import { hashApiKey } from "../src/auth/api-key.js";
import { type Config, loadConfig } from "../src/config.js";
import { type BuiltApp, buildApp } from "../src/server.js";

/**
 * Set up a dedicated ClickHouse database for one test run and seed a project
 * + API key. Returns the app instance plus cleanup handles.
 *
 * Each call uses a unique database so parallel tests don't collide.
 */
export interface TestEnv {
  app: BuiltApp;
  client: ClickHouseClient;
  projectId: string;
  apiKey: string;
  config: Config;
  cleanup: () => Promise<void>;
}

export async function setupTestEnv(): Promise<TestEnv> {
  const dbName = `clawobs_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const base = loadConfig();
  const config: Config = { ...base, clickhouseDb: dbName, logLevel: "warn" };

  await migrate({
    url: config.clickhouseUrl,
    database: dbName,
    username: config.clickhouseUser,
    password: config.clickhousePassword,
  });

  const client = createAppClient({
    url: config.clickhouseUrl,
    database: dbName,
    username: config.clickhouseUser,
    password: config.clickhousePassword,
  });

  const projectId = randomUUID();
  await client.insert({
    table: "projects",
    values: [{ id: projectId, slug: "test", name: "test" }],
    format: "JSONEachRow",
  });

  const apiKey = `ck_test_${randomUUID().replaceAll("-", "")}`;
  await client.insert({
    table: "api_keys",
    values: [
      {
        project_id: projectId,
        key_hash: hashApiKey(apiKey),
        prefix: apiKey.slice(0, 8),
        name: "test",
      },
    ],
    format: "JSONEachRow",
  });

  const app = await buildApp(config);

  return {
    app,
    client,
    projectId,
    apiKey,
    config,
    async cleanup() {
      await app.close();
      await client.command({ query: `DROP DATABASE IF EXISTS ${dbName}` });
      await client.close();
    },
  };
}

/** Wait for a predicate to return a truthy value, polling every 50ms. */
export async function waitFor<T>(
  fn: () => Promise<T | null | undefined>,
  timeoutMs = 5_000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
}
