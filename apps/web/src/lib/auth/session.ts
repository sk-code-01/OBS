import { addDays } from "@/lib/time";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getConfig } from "@/lib/config";
import { generateSessionId } from "@/lib/ids";
import { db } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { signValue, verifySignedValue } from "./crypto";

const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Secure-session" : "session";
const SESSION_DAYS = 30;

export interface AppSession {
  sessionId: string;
  userId: string;
  email: string;
  projectId: string;
}

function cookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}

async function readSignedSessionId(): Promise<string | null> {
  const store = await cookies();
  const cookie = store.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  return verifySignedValue(cookie, getConfig().SESSION_COOKIE_SECRET);
}

export async function createSession(userId: string): Promise<string> {
  const sessionId = generateSessionId();
  const expiresAt = addDays(new Date(), SESSION_DAYS);

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    expiresAt,
  });

  const store = await cookies();
  store.set(
    SESSION_COOKIE,
    signValue(sessionId, getConfig().SESSION_COOKIE_SECRET),
    cookieOptions(expiresAt),
  );

  return sessionId;
}

export async function getSession(): Promise<AppSession | null> {
  const sessionId = await readSignedSessionId();
  if (!sessionId) return null;

  const [row] = await db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      email: users.email,
      projectId: users.defaultProjectId,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!row) return null;

  return row;
}

export async function requireSession(): Promise<AppSession> {
  const session = await getSession();
  if (!session) redirect("/auth");
  return session;
}

export async function destroySession(): Promise<void> {
  const sessionId = await readSignedSessionId();
  if (sessionId) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  }

  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
