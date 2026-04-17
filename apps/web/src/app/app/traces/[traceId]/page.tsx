import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/session";
import { getTrace } from "@/lib/clickhouse/queries";
import { Waterfall } from "./waterfall";
import { formatCompactNumber, formatUsd } from "@/lib/time";

interface TraceDetailPageProps {
  params: Promise<{ traceId: string }>;
}

export default async function TraceDetailPage({
  params,
}: TraceDetailPageProps): Promise<React.JSX.Element> {
  const session = await requireSession();
  const { traceId } = await params;
  const trace = await getTrace(session.projectId, traceId);

  if (!trace.trace) notFound();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="break-all">Trace {trace.trace.traceId}</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            Started {trace.trace.startedAt} • session {trace.trace.sessionId ?? "—"}
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          {[
            ["Status", trace.trace.status ?? "mixed"],
            ["LLM calls", formatCompactNumber(trace.trace.llmCallCount)],
            ["Tool calls", formatCompactNumber(trace.trace.toolCallCount)],
            ["Cost", formatUsd(trace.trace.totalCostUsd)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-border/70 bg-muted/30 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
              <div className="mt-2 text-xl font-semibold">{value}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Waterfall</CardTitle>
        </CardHeader>
        <CardContent>
          <Waterfall spans={trace.spans} />
        </CardContent>
      </Card>

      <div className="space-y-4">
        {trace.spans.map((span) => (
          <Card key={`${span.spanId}-${span.startTime}`}>
            <CardHeader>
              <CardTitle className="text-lg">{span.name}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {span.kind} • {span.startTime}
              </p>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <details className="rounded-2xl border border-border/70 bg-muted/25 p-4">
                <summary className="cursor-pointer font-medium">Input</summary>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
                  {JSON.stringify(span.input ?? {}, null, 2)}
                </pre>
              </details>
              <details className="rounded-2xl border border-border/70 bg-muted/25 p-4">
                <summary className="cursor-pointer font-medium">Output</summary>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
                  {JSON.stringify(span.output ?? {}, null, 2)}
                </pre>
              </details>
              {span.error ? (
                <details className="rounded-2xl border border-danger/20 bg-danger/10 p-4">
                  <summary className="cursor-pointer font-medium text-danger">Error</summary>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-danger">
                    {JSON.stringify(span.error, null, 2)}
                  </pre>
                </details>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
