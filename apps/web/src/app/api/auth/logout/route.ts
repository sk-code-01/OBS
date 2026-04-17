import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth/session";
import { getConfig } from "@/lib/config";

export async function POST(): Promise<NextResponse> {
  await destroySession();
  return NextResponse.redirect(new URL("/auth", getConfig().PUBLIC_APP_URL));
}
