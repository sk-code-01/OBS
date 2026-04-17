import { createHash } from "node:crypto";
import { clickhouse } from "./client";
import { generateApiKey } from "@/lib/ids";

export interface ApiKeyRecord {
  keyHash: string;
  prefix: string;
  name: string;
  createdAt: string;
  revokedAt: string | null;
}

function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

function prefixForKey(rawKey: string): string {
  return rawKey.slice(0, "ck_live_".length + 6);
}

export async function issueKey(projectId: string, name: string): Promise<{ rawKey: string; prefix: string }> {
  const rawKey = generateApiKey();
  const prefix = prefixForKey(rawKey);

  await clickhouse.insert({
    table: "api_keys",
    values: [
      {
        project_id: projectId,
        key_hash: hashApiKey(rawKey),
        prefix,
        name,
        created_at: new Date().toISOString(),
        revoked_at: null,
      },
    ],
    format: "JSONEachRow",
  });

  return { rawKey, prefix };
}

export async function listKeys(projectId: string): Promise<ApiKeyRecord[]> {
  const result = await clickhouse.query({
    query:
      "SELECT toString(key_hash) AS key_hash, prefix, name, " +
      "toString(created_at) AS created_at, " +
      "if(isNull(revoked_at), NULL, toString(revoked_at)) AS revoked_at " +
      "FROM api_keys FINAL WHERE project_id = {projectId:UUID} " +
      "ORDER BY created_at DESC",
    query_params: { projectId },
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    keyHash: String(row.key_hash),
    prefix: String(row.prefix),
    name: String(row.name),
    createdAt: String(row.created_at),
    revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
  }));
}

export async function revokeKey(projectId: string, keyHash: string): Promise<void> {
  const keys = await listKeys(projectId);
  const current = keys.find((item) => item.keyHash === keyHash);
  if (!current || current.revokedAt) return;

  await clickhouse.insert({
    table: "api_keys",
    values: [
      {
        project_id: projectId,
        key_hash: keyHash,
        prefix: current.prefix,
        name: current.name,
        created_at: new Date().toISOString(),
        revoked_at: new Date().toISOString(),
      },
    ],
    format: "JSONEachRow",
  });
}
