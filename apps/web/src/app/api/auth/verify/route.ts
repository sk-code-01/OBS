import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { createProject } from "@/lib/clickhouse/projects";
import { issueKey, listKeys } from "@/lib/clickhouse/keys";
import { setFirstKeyCookie } from "@/lib/auth/first-key";
import { consumeMagicLinkToken } from "@/lib/auth/magic-link";
import { createSession } from "@/lib/auth/session";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

function authRedirect(error: string): NextResponse {
  const url = new URL("/auth", getConfig().PUBLIC_APP_URL);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return authRedirect("expired");

  const email = await consumeMagicLinkToken(token);
  if (!email) return authRedirect("expired");

  let [user] = await db
    .select({
      id: users.id,
      email: users.email,
      defaultProjectId: users.defaultProjectId,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  let firstKey: string | null = null;

  if (!user) {
    const projectId = randomUUID();
    const [created] = await db
      .insert(users)
      .values({
        email,
        defaultProjectId: projectId,
      })
      .returning({
        id: users.id,
        email: users.email,
        defaultProjectId: users.defaultProjectId,
      });

    await createProject(projectId, email);
    const issued = await issueKey(projectId, "default");
    firstKey = issued.rawKey;
    user = created;
  } else {
    const activeKeys = (await listKeys(user.defaultProjectId)).filter((key) => !key.revokedAt);
    if (activeKeys.length === 0) {
      const issued = await issueKey(user.defaultProjectId, "default");
      firstKey = issued.rawKey;
    }
  }

  await createSession(user.id);
  if (firstKey) {
    await setFirstKeyCookie(firstKey);
  }

  return NextResponse.redirect(new URL(firstKey ? "/app/setup" : "/app", getConfig().PUBLIC_APP_URL));
}
