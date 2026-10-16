"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/components/ui/status-banner";
import { reschedulePost, type CalendarFormState } from "@/modules/calendar/actions";

const initialState: CalendarFormState = { status: "idle", message: "" };

export function CalendarEventForm({
  workspaceId,
  postId,
  localDateTime,
  timezone,
  canEdit,
}: {
  workspaceId: string;
  postId: string;
  localDateTime: string;
  timezone: string;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(reschedulePost, initialState);

  if (!canEdit) {
    return null;
  }

  return (
    <form action={formAction} className="mt-2 grid gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="timezone" value={timezone} />
      <input
        name="localDateTime"
        type="datetime-local"
        defaultValue={localDateTime}
        className="min-h-9 rounded-xl border border-ink/10 bg-white px-2 text-xs"
      />
      {state.message ? (
        <StatusBanner tone={state.status === "success" ? "success" : "warning"}>{state.message}</StatusBanner>
      ) : null}
      <Button type="submit" variant="secondary" disabled={pending} className="min-h-9 px-3 text-xs">
        {pending ? "Сохраняем..." : "Перенести"}
      </Button>
    </form>
  );
}
