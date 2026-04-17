"use server";

import { redirect } from "next/navigation";
import { mintMagicLinkToken, normalizeEmail } from "@/lib/auth/magic-link";
import { sendMagicLinkEmail } from "@/lib/auth/email";

export async function requestMagicLink(formData: FormData): Promise<void> {
  const rawEmail = formData.get("email");
  const email = typeof rawEmail === "string" ? normalizeEmail(rawEmail) : "";

  if (!email || !email.includes("@")) {
    redirect("/auth?error=invalid-email");
  }

  const token = await mintMagicLinkToken(email);
  await sendMagicLinkEmail(email, token);
  redirect("/auth?sent=1");
}
