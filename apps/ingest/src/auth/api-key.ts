import { createHash } from "node:crypto";
import type { ClickHouseClient } from "@clickhouse/client";

/**
 * API-key auth. Keys are hashed (SHA-256) at write time; we compare hashes.
 *
 * Results are cached in-memory for `ttlMs` to avoid a ClickHouse lookup on
 * every ingest request. Cache key is the raw token; revocations propagate
 * within `ttlMs`.
 */
export interface ApiKeyAuth {
  resolve(bearerToken: string): Promise<string | null>;
}

interface CacheEntry {
  projectId: string | null; // null = known-bad
  expiresAt: number;
}

export function createApiKeyAuth(client: ClickHouseClient, ttlMs: number): ApiKeyAuth {
  const cache = new Map<string, CacheEntry>();

  return {
    async resolve(token: string): Promise<string | null> {
      const now = Date.now();
      const cached = cache.get(token);
      if (cached && cached.expiresAt > now) return cached.projectId;

      const hash = createHash("sha256").update(token).digest("hex");
      const result = await client.query({
        query:
          "SELECT toString(project_id) AS project_id FROM api_keys FINAL " +
          "WHERE key_hash = {hash:String} AND revoked_at IS NULL LIMIT 1",
        query_params: { hash },
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as Array<{ project_id: string }>;
      const projectId = rows[0]?.project_id ?? null;

      cache.set(token, { projectId, expiresAt: now + ttlMs });
      return projectId;
    },
  };
}

/** Deterministic hash helper, exposed for tests/seeding. */
export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
