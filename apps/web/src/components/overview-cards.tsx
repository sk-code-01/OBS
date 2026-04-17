import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Overview } from "@/lib/clickhouse/queries";
import { formatCompactNumber, formatRelativeDuration, formatUsd } from "@/lib/time";

export function OverviewCards({ overview }: { overview: Overview }): React.JSX.Element {
  const cards = [
    {
      label: "Trace volume",
      value: formatCompactNumber(overview.traceCount),
      hint: `${formatCompactNumber(overview.llmCallCount)} LLM calls`,
    },
    {
      label: "Tool activity",
      value: formatCompactNumber(overview.toolCallCount),
      hint: `${formatCompactNumber(overview.totalTokens)} tokens`,
    },
    {
      label: "Observed spend",
      value: formatUsd(overview.totalCostUsd),
      hint: "Direct from ClickHouse rollups",
    },
    {
      label: "p95 runtime",
      value: formatRelativeDuration(overview.p95DurationMs),
      hint: `avg ${formatRelativeDuration(overview.avgDurationMs)}`,
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-[0.18em] text-muted-foreground">
              {card.label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tracking-tight">{card.value}</div>
            <p className="mt-2 text-sm text-muted-foreground">{card.hint}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
