import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/session";
import { listTraces } from "@/lib/clickhouse/queries";
import { TracesLive } from "./traces-live";

export default async function TracesPage(): Promise<React.JSX.Element> {
  const session = await requireSession();
  const initial = await listTraces(session.projectId, { limit: 50 });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trace stream</CardTitle>
        <p className="mt-2 text-sm text-muted-foreground">
          Polling every 3 seconds so you can watch OpenClaw connect in near-realtime.
        </p>
      </CardHeader>
      <CardContent>
        <TracesLive initial={initial} />
      </CardContent>
    </Card>
  );
}
