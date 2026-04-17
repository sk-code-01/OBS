import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/session";
import { getConfig } from "@/lib/config";
import { hasFirstKeyCookie } from "@/lib/auth/first-key";
import { listKeys } from "@/lib/clickhouse/keys";
import { listTraces } from "@/lib/clickhouse/queries";
import { ConnectionStatus } from "./connection-status";
import { MagicMessage } from "./magic-message";

export default async function SetupPage(): Promise<React.JSX.Element> {
  const session = await requireSession();
  const [cookiePresent, keys, traces] = await Promise.all([
    hasFirstKeyCookie(),
    listKeys(session.projectId),
    listTraces(session.projectId, { limit: 1 }),
  ]);

  if (!cookiePresent && keys.some((key) => !key.revokedAt)) {
    redirect("/app/settings?missingKey=1");
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-[var(--font-serif)] text-4xl">Connect your OpenClaw.</CardTitle>
          <p className="mt-2 max-w-2xl text-base leading-7 text-muted-foreground">
            Paste this into your OpenClaw chat. It’s deliberately plain language because the key and
            ingest URL are the only load-bearing parts.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <ConnectionStatus initiallyConnected={traces.items.length > 0} />
          <MagicMessage ingestUrl={getConfig().PUBLIC_INGEST_URL} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Self-hosted OpenClaw?</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-2xl border border-border/70 bg-muted/25 p-4 text-sm leading-7">
{`pnpm add @clawobs/plugin-openclaw
// openclaw.config.ts
plugins: [clawobs({ apiKey: "ck_live_…", ingestUrl: "${getConfig().PUBLIC_INGEST_URL}" })]`}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Not seeing traces?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-7 text-muted-foreground">
            <p>1. Make sure the API key in the pasted message was not truncated.</p>
            <p>2. Restart OpenClaw so the plugin actually loads.</p>
            <p>3. Trigger at least one LLM call after install. No model call means no trace.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
