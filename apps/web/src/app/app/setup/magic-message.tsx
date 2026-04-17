"use client";

import { useEffect, useMemo, useState } from "react";
import { CopyButton } from "@/components/copy-button";

export function MagicMessage({
  ingestUrl,
}: {
  ingestUrl: string;
}): React.JSX.Element {
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/first-key", { method: "POST" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to consume first key cookie");
        const body = (await res.json()) as { rawKey: string | null };
        if (!cancelled) setRawKey(body.rawKey);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const message = useMemo(() => {
    if (!rawKey) return "";
    return `Hi OpenClaw, please install the npm package \`@clawobs/plugin-openclaw\` and configure it with \`apiKey: ${rawKey}\` and \`ingestUrl: ${ingestUrl}\`. Then restart so the plugin loads. Thanks.`;
  }, [ingestUrl, rawKey]);

  if (loading) {
    return <div className="text-sm text-muted-foreground">Preparing your setup message…</div>;
  }

  if (!rawKey) {
    return (
      <div className="rounded-2xl border border-danger/20 bg-danger/10 px-4 py-4 text-sm text-danger">
        Your one-time key is no longer in the signup cookie. Head to Settings and rotate a new key
        to regenerate the setup message.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-foreground">Paste this into your OpenClaw chat.</div>
          <div className="text-sm text-muted-foreground">It includes your live API key and hosted ingest URL.</div>
        </div>
        <CopyButton label="Copy message" text={message} />
      </div>
      <pre className="overflow-x-auto rounded-[24px] border border-border/80 bg-[#082725] p-5 text-sm leading-7 text-[#dffaf2]">
        {message}
      </pre>
    </div>
  );
}
