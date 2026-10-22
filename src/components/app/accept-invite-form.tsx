"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/components/ui/status-banner";
import { acceptInvite, type CollaborationFormState } from "@/modules/collaboration/actions";

const idle: CollaborationFormState = { status: "idle", message: "" };

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(acceptInvite, idle);
  return (
    <form action={formAction} className="grid gap-3">
      <input type="hidden" name="token" value={token} />
      {state.message ? <StatusBanner tone="warning">{state.message}</StatusBanner> : null}
      <Button disabled={pending}>{pending ? "Принимаем..." : "Принять приглашение"}</Button>
    </form>
  );
}
