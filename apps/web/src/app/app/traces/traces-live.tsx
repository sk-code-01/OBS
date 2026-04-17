"use client";

import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TraceSummary } from "@/lib/clickhouse/queries";
import { TraceRow } from "@/components/trace-row";

interface TraceListResponse {
  items: TraceSummary[];
  nextCursor: string | null;
}

async function fetchTraces(): Promise<TraceListResponse> {
  const res = await fetch("/api/traces?limit=50", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load traces");
  return res.json();
}

export function TracesLive({ initial }: { initial: TraceListResponse }): React.JSX.Element {
  const query = useQuery({
    queryKey: ["traces"],
    queryFn: fetchTraces,
    initialData: initial,
    refetchInterval: 3_000,
  });

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Trace</TableHead>
            <TableHead>Session</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>LLM</TableHead>
            <TableHead>Tools</TableHead>
            <TableHead>Tokens</TableHead>
            <TableHead>Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data.items.length > 0 ? (
            query.data.items.map((trace) => (
              <TableRow key={trace.traceId}>
                <TraceRow trace={trace} />
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell className="py-8 text-sm text-muted-foreground" colSpan={7}>
                Waiting for the first span to land.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
