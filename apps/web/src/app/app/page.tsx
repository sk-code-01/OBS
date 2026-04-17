import Link from "next/link";
import { OverviewCards } from "@/components/overview-cards";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/session";
import { getOverview, listTraces } from "@/lib/clickhouse/queries";
import { TraceRow } from "@/components/trace-row";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function DashboardOverviewPage(): Promise<React.JSX.Element> {
  const session = await requireSession();
  const [overview, traces] = await Promise.all([
    getOverview(session.projectId),
    listTraces(session.projectId, { limit: 5 }),
  ]);

  return (
    <div className="space-y-6">
      <OverviewCards overview={overview} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent traces</CardTitle>
            <p className="mt-2 text-sm text-muted-foreground">
              Freshly ingested runs from your OpenClaw project.
            </p>
          </div>
          <Link className="text-sm font-medium text-primary" href="/app/traces">
            View all
          </Link>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-2xl border border-border/70">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Conversation</TableHead>
                  <TableHead>Session</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>LLM</TableHead>
                  <TableHead>Tools</TableHead>
                  <TableHead>Tokens</TableHead>
                  <TableHead>Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {traces.items.length > 0 ? (
                  traces.items.map((trace) => (
                    <TableRow key={trace.traceId}>
                      <TraceRow trace={trace} />
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell className="py-8 text-sm text-muted-foreground" colSpan={7}>
                      No traces yet. Head to Setup, paste the install message into OpenClaw, and
                      then trigger a run.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
