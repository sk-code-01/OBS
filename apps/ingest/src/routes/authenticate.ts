import type { ApiKeyAuth } from "../auth/api-key.js";

export async function resolveProjectIdFromAuthorization(
  header: string | undefined,
  auth: ApiKeyAuth,
): Promise<string | null> {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return auth.resolve(match[1].trim());
}
