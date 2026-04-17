import { NextResponse } from "next/server";
import { consumeFirstKeyCookie } from "@/lib/auth/first-key";
import { getSession } from "@/lib/auth/session";

export async function POST(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rawKey = await consumeFirstKeyCookie();
  return NextResponse.json({ rawKey });
}
