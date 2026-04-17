import Link from "next/link";
import type { TraceSummary } from "@/lib/clickhouse/queries";
import { formatCompactNumber, formatUsd } from "@/lib/time";

function statusColor(status: string | null): string {
  if (status === "error") return "bg-danger/15 text-danger";
  if (status === "ok") return "bg-primary/10 text-primary";
  return "bg-muted text-muted-foreground";
}

export function TraceRow({ trace }: { trace: TraceSummary }): React.JSX.Element {
  return (
    <>
      <td className="px-4 py-3">
        <Link className="font-medium text-foreground hover:text-primary" href={`/app/traces/${trace.traceId}`}>
          {trace.traceId}
        </Link>
        <div className="mt-1 text-xs text-muted-foreground">{trace.startedAt}</div>
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">{trace.sessionId ?? "—"}</td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusColor(trace.status)}`}>
          {trace.status ?? "mixed"}
        </span>
      </td>
      <td className="px-4 py-3 text-sm">{formatCompactNumber(trace.llmCallCount)}</td>
      <td className="px-4 py-3 text-sm">{formatCompactNumber(trace.toolCallCount)}</td>
      <td className="px-4 py-3 text-sm">{formatCompactNumber(trace.totalTokens)}</td>
      <td className="px-4 py-3 text-sm">{formatUsd(trace.totalCostUsd)}</td>
    </>
  );
}
