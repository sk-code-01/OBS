"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TraceSummary } from "@/lib/clickhouse/queries";

interface TraceListResponse {
  items: TraceSummary[];
  nextCursor: string | null;
}

async function fetchLatestTrace(): Promise<TraceListResponse> {
  const res = await fetch("/api/traces?limit=1", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to poll traces");
  return res.json();
}

export function ConnectionStatus({ initiallyConnected }: { initiallyConnected: boolean }): React.JSX.Element {
  const [connected, setConnected] = useState(initiallyConnected);

  const query = useQuery({
    queryKey: ["connection-status"],
    queryFn: fetchLatestTrace,
    initialData: { items: [], nextCursor: null },
    enabled: !connected,
    refetchInterval: connected ? false : 3_000,
  });

  useEffect(() => {
    if (!connected && query.data.items.length > 0) {
      setConnected(true);
    }
  }, [connected, query.data.items.length]);

  return (
    <div
      className={`inline-flex rounded-full px-4 py-2 text-sm font-medium ${
        connected ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground"
      }`}
    >
      {connected ? "Connected. First trace received." : "Waiting for first span… polling every 3s"}
    </div>
  );
}
