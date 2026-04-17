import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { magicLinkTokens } from "@/lib/db/schema";
import { generateMagicLinkToken } from "@/lib/ids";

const TOKEN_TTL_MS = 15 * 60 * 1000;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function mintMagicLinkToken(email: string): Promise<string> {
  const token = generateMagicLinkToken();
  await db.insert(magicLinkTokens).values({
    id: token,
    email: normalizeEmail(email),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  });
  return token;
}

export async function consumeMagicLinkToken(token: string): Promise<string | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(magicLinkTokens)
      .where(eq(magicLinkTokens.id, token))
      .limit(1);

    if (!row || row.consumedAt || row.expiresAt.getTime() < Date.now()) {
      return null;
    }

    await tx.update(magicLinkTokens).set({ consumedAt: new Date() }).where(eq(magicLinkTokens.id, token));

    return normalizeEmail(row.email);
  });
}
