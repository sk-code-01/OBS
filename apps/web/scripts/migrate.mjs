import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required for web migrations");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(__dirname, "..", "drizzle");

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
});

try {
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder });
  console.log(`applied web migrations from ${migrationsFolder}`);
} catch (error) {
  console.error("web migration failed:", error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
