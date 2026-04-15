import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Load ../../.env into process.env for tests. Zero-dep .env loader —
// handles KEY=VAL lines and `#` comments, ignores blanks. Good enough for
// the handful of vars we read.
function loadDotEnv(path: string): Record<string, string> {
  try {
    const raw = readFileSync(path, "utf8");
    const out: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (k) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

const env = loadDotEnv(resolve(__dirname, "..", "..", ".env"));

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 90_000,
    hookTimeout: 90_000,
    env,
  },
});
