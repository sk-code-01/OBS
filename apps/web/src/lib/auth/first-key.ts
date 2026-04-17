import { cookies } from "next/headers";
import { getConfig } from "@/lib/config";
import { decryptValue, encryptValue } from "./crypto";

const FIRST_KEY_COOKIE = process.env.NODE_ENV === "production" ? "__Secure-first_key" : "first_key";
const FIRST_KEY_TTL_SECONDS = 60 * 10;

function cookieOptions(maxAge = FIRST_KEY_TTL_SECONDS) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export async function setFirstKeyCookie(rawKey: string): Promise<void> {
  const store = await cookies();
  const encrypted = encryptValue(rawKey, getConfig().FIRST_KEY_COOKIE_SECRET);
  store.set(FIRST_KEY_COOKIE, encrypted, cookieOptions());
}

export async function hasFirstKeyCookie(): Promise<boolean> {
  const store = await cookies();
  return Boolean(store.get(FIRST_KEY_COOKIE)?.value);
}

export async function consumeFirstKeyCookie(): Promise<string | null> {
  const store = await cookies();
  const cookie = store.get(FIRST_KEY_COOKIE)?.value;
  if (!cookie) return null;

  store.delete(FIRST_KEY_COOKIE);
  return decryptValue(cookie, getConfig().FIRST_KEY_COOKIE_SECRET);
}
