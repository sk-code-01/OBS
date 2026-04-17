"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { issueKey, listKeys, revokeKey } from "@/lib/clickhouse/keys";

export interface RotateKeyState {
  status: "idle" | "success" | "error";
  message?: string;
  rawKey?: string;
}

export async function rotateKey(_prev: RotateKeyState, _formData: FormData): Promise<RotateKeyState> {
  const session = await requireSession();
  const keys = await listKeys(session.projectId);
  const active = keys.find((key) => !key.revokedAt);
  if (active) {
    await revokeKey(session.projectId, active.keyHash);
  }

  const issued = await issueKey(session.projectId, "default");
  return {
    status: "success",
    message: "A new key is ready. Copy it now because it won’t be shown again after refresh.",
    rawKey: issued.rawKey,
  };
}

export async function revokeKeyAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const keyHash = formData.get("keyHash");
  if (typeof keyHash === "string" && keyHash.length > 0) {
    await revokeKey(session.projectId, keyHash);
  }
  redirect("/app/settings");
}
