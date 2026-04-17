import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { listTraces } from "@/lib/clickhouse/queries";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const limit = Number(searchParams.get("limit") ?? "50");
  const before = searchParams.get("before") ?? undefined;
  const sessionId = searchParams.get("sessionId") ?? undefined;
  const status = searchParams.get("status") as "ok" | "error" | "in_progress" | null;

  const traces = await listTraces(session.projectId, {
    limit: Number.isFinite(limit) ? Math.max(1, Math.min(limit, 200)) : 50,
    before,
    sessionId,
    status: status ?? undefined,
  });

  return NextResponse.json(traces);
}
