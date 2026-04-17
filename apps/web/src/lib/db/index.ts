import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { getConfig } from "@/lib/config";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __clawobsPostgresClient: postgres.Sql | undefined;
  // eslint-disable-next-line no-var
  var __clawobsDb: ReturnType<typeof drizzle> | undefined;
}

function createSqlClient(): postgres.Sql {
  return postgres(getConfig().DATABASE_URL, {
    prepare: false,
    max: 5,
  });
}

export function getSql(): postgres.Sql {
  if (globalThis.__clawobsPostgresClient) return globalThis.__clawobsPostgresClient;

  const client = createSqlClient();
  if (process.env.NODE_ENV !== "production") {
    globalThis.__clawobsPostgresClient = client;
  }
  return client;
}

export function getDb(): ReturnType<typeof drizzle> {
  if (globalThis.__clawobsDb) return globalThis.__clawobsDb;

  const database = drizzle(getSql(), { schema });
  if (process.env.NODE_ENV !== "production") {
    globalThis.__clawobsDb = database;
  }
  return database;
}

export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop, receiver) {
    const value = Reflect.get(getDb(), prop, receiver);
    return typeof value === "function" ? value.bind(getDb()) : value;
  },
});

export const sql = new Proxy(getSql, {
  apply(_target, thisArg, args) {
    return Reflect.apply(getSql(), thisArg, args);
  },
  get(_target, prop, receiver) {
    const value = Reflect.get(getSql(), prop, receiver);
    return typeof value === "function" ? value.bind(getSql()) : value;
  },
}) as unknown as postgres.Sql;
