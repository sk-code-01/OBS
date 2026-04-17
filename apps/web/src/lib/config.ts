import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  SESSION_COOKIE_SECRET: z.string().min(32),
  FIRST_KEY_COOKIE_SECRET: z.string().min(32),
  CLICKHOUSE_URL: z.string().url(),
  CLICKHOUSE_DB: z.string().min(1).default("clawobs"),
  CLICKHOUSE_USER: z.string().min(1).optional(),
  CLICKHOUSE_PASSWORD: z.string().min(1).optional(),
  PUBLIC_INGEST_URL: z.string().url(),
  PUBLIC_APP_URL: z.string().url(),
});

export type AppConfig = z.infer<typeof envSchema>;

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;
  cachedConfig = envSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    SESSION_COOKIE_SECRET: process.env.SESSION_COOKIE_SECRET,
    FIRST_KEY_COOKIE_SECRET: process.env.FIRST_KEY_COOKIE_SECRET,
    CLICKHOUSE_URL: process.env.CLICKHOUSE_URL,
    CLICKHOUSE_DB: process.env.CLICKHOUSE_DB,
    CLICKHOUSE_USER: process.env.CLICKHOUSE_USER,
    CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD,
    PUBLIC_INGEST_URL: process.env.PUBLIC_INGEST_URL,
    PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,
  });
  return cachedConfig;
}
