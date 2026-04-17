import Link from "next/link";
import type { TraceSummary } from "@/lib/clickhouse/queries";
import { formatCompactNumber, formatUsd } from "@/lib/time";

function statusColor(status: string | null): string {
  if (status === "error") return "bg-danger/15 text-danger";
  if (status === "ok") return "bg-primary/10 text-primary";
  return "bg-muted text-muted-foreground";
}

export function TraceRow({ trace }: { trace: TraceSummary }): React.JSX.Element {
  const title = trace.conversationPreview ?? trace.traceId;
  const contextLine = [trace.senderName, trace.messageAt].filter(Boolean).join(" • ");

  return (
    <>
      <td className="px-4 py-3">
        <Link className="font-medium text-foreground hover:text-primary" href={`/app/traces/${trace.traceId}`}>
          {title}
        </Link>
        <div className="mt-1 text-xs text-muted-foreground">
          {contextLine || trace.startedAt}
        </div>
        <div className="mt-1 font-mono text-[11px] text-muted-foreground/80">{trace.traceId}</div>
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
