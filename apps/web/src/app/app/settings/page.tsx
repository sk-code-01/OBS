import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConfig } from "@/lib/config";
import { listKeys } from "@/lib/clickhouse/keys";
import { revokeKeyAction } from "./actions";
import { RotateKeyForm } from "./rotate-key-form";

interface SettingsPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SettingsPage({
  searchParams,
}: SettingsPageProps): Promise<React.JSX.Element> {
  const session = await requireSession();
  const params = (await searchParams) ?? {};
  const keys = await listKeys(session.projectId);

  return (
    <div className="space-y-6">
      {params.missingKey === "1" ? (
        <div className="rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
          Your one-time setup key has already been consumed. Rotate a new key to generate another
          install message.
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            Keys are hashed in ClickHouse. Rotations and revocations propagate to ingest within the
            API-key cache TTL.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <RotateKeyForm ingestUrl={getConfig().PUBLIC_INGEST_URL} />

          <div className="space-y-3">
            {keys.length > 0 ? (
              keys.map((key) => (
                <div
                  key={`${key.keyHash}-${key.createdAt}`}
                  className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-muted/20 p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <div className="font-medium text-foreground">{key.prefix}</div>
                    <div className="text-sm text-muted-foreground">
                      {key.name} • created {key.createdAt}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {key.revokedAt ? `Revoked ${key.revokedAt}` : "Active"}
                    </div>
                  </div>
                  {!key.revokedAt ? (
                    <form action={revokeKeyAction}>
                      <input name="keyHash" type="hidden" value={key.keyHash} />
                      <Button type="submit" variant="danger" size="sm">
                        Revoke
                      </Button>
                    </form>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
                No keys exist yet. Rotate once to create the first one.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
