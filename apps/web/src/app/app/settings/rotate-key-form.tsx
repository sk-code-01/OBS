"use client";

import { useActionState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import type { RotateKeyState } from "./actions";
import { rotateKey } from "./actions";

const initialState: RotateKeyState = { status: "idle" };

export function RotateKeyForm({ ingestUrl }: { ingestUrl: string }): React.JSX.Element {
  const [state, formAction, pending] = useActionState(rotateKey, initialState);

  const message = state.rawKey
    ? `Hi OpenClaw, please install the npm package \`@clawobs/plugin-openclaw\` and configure it with \`apiKey: ${state.rawKey}\` and \`ingestUrl: ${ingestUrl}\`. Then restart so the plugin loads. Thanks.`
    : "";

  return (
    <div className="space-y-4">
      <form action={formAction}>
        <Button disabled={pending} type="submit">
          {pending ? "Rotating…" : "Rotate default key"}
        </Button>
      </form>

      {state.status === "success" && state.rawKey ? (
        <div className="space-y-3 rounded-2xl border border-primary/20 bg-primary/10 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-primary">New raw key</div>
              <p className="text-sm text-primary/80">{state.message}</p>
            </div>
            <CopyButton text={state.rawKey} label="Copy key" />
          </div>
          <pre className="overflow-x-auto rounded-2xl bg-white/80 p-3 text-xs text-foreground">
            {state.rawKey}
          </pre>
          <div className="text-xs text-muted-foreground">
            If you want the full paste-message, copy the key now and drop it into the Setup screen’s
            template.
          </div>
          <CopyButton text={message} label="Copy full setup message" />
        </div>
      ) : null}
    </div>
  );
}
