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
  const freshness = describeTraceFreshness(query.data.items[0]);

  return (
    <div className="space-y-3">
      <div className={`rounded-2xl border px-4 py-3 text-sm ${freshness.tone}`}>
        <span className="font-medium">{freshness.label}</span>
        <span className="ml-2 text-muted-foreground">{freshness.detail}</span>
      </div>
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
    </div>
  );
}

function describeTraceFreshness(latest: TraceSummary | undefined): {
  label: string;
  detail: string;
  tone: string;
} {
  if (!latest) {
    return {
      label: "Waiting for traces",
      detail: "No visible traces have landed yet.",
      tone: "border-border/70 bg-muted/30",
    };
  }

  const startedAtMs = parseClickHouseTimestamp(latest.startedAt);
  if (startedAtMs == null) {
    return {
      label: "Trace stream loaded",
      detail: "ClawObs has data, but the latest timestamp could not be parsed.",
      tone: "border-border/70 bg-muted/30",
    };
  }

  const ageMs = Math.max(0, Date.now() - startedAtMs);
  if (ageMs <= 2 * 60 * 1000) {
    return {
      label: "Live sync",
      detail: `Latest visible trace is ${formatAge(ageMs)} old.`,
      tone: "border-primary/30 bg-primary/5",
    };
  }

  return {
    label: "Sync looks stale",
    detail:
      `Latest visible trace is ${formatAge(ageMs)} old. ` +
      "If your newest OpenClaw message is missing, it likely has not been ingested yet.",
    tone: "border-amber-500/30 bg-amber-500/5",
  };
}

function parseClickHouseTimestamp(value: string): number | null {
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatAge(ageMs: number): string {
  if (ageMs < 10_000) return "a few seconds";
  if (ageMs < 60_000) return `${Math.round(ageMs / 1_000)}s`;
  if (ageMs < 60 * 60 * 1000) return `${Math.round(ageMs / 60_000)}m`;
  return `${Math.round(ageMs / (60 * 60 * 1000))}h`;
}
