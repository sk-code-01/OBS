import type { SpanDetail } from "@/lib/clickhouse/queries";
import { formatRelativeDuration } from "@/lib/time";

function buildLevels(spans: SpanDetail[]): Map<string, number> {
  const levels = new Map<string, number>();
  const byId = new Map(spans.map((span) => [span.spanId, span]));

  const resolveLevel = (span: SpanDetail): number => {
    if (!span.parentSpanId) return 0;
    const cached = levels.get(span.spanId);
    if (cached != null) return cached;
    const parent = byId.get(span.parentSpanId);
    if (!parent) return 1;
    const level = resolveLevel(parent) + 1;
    levels.set(span.spanId, level);
    return level;
  };

  for (const span of spans) {
    levels.set(span.spanId, resolveLevel(span));
  }

  return levels;
}

export function Waterfall({ spans }: { spans: SpanDetail[] }): React.JSX.Element {
  if (spans.length === 0) {
    return <div className="text-sm text-muted-foreground">No spans captured for this trace yet.</div>;
  }

  const startedAt = Math.min(...spans.map((span) => new Date(span.startTime).getTime()));
  const endedAt = Math.max(
    ...spans.map((span) => new Date(span.endTime ?? span.startTime).getTime()),
  );
  const total = Math.max(endedAt - startedAt, 1);
  const levels = buildLevels(spans);

  return (
    <div className="space-y-3">
      {spans.map((span) => {
        const start = new Date(span.startTime).getTime() - startedAt;
        const end = new Date(span.endTime ?? span.startTime).getTime() - startedAt;
        const width = Math.max(((end - start) / total) * 100, 2);
        const offset = (start / total) * 100;
        const level = levels.get(span.spanId) ?? 0;

        return (
          <div key={`${span.spanId}-${span.startTime}`} className="grid gap-3 md:grid-cols-[320px_1fr]">
            <div className="rounded-2xl border border-border/70 bg-white/70 px-4 py-3">
              <div className="text-sm font-medium">{span.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {span.kind} • {formatRelativeDuration(span.durationMs)}
              </div>
            </div>
            <div className="relative flex h-14 items-center rounded-2xl border border-border/70 bg-muted/35 px-3">
              <div
                className="absolute h-5 rounded-full bg-primary/85"
                style={{
                  left: `${offset}%`,
                  width: `${width}%`,
                  marginLeft: `${level * 12}px`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
