"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/components/ui/status-banner";
import { enqueuePost, type PublishFormState } from "@/modules/publishing/actions";

const initialState: PublishFormState = { status: "idle", message: "" };

export function EnqueueForm({
  workspaceId,
  postId,
  canEnqueue,
  postStatus,
}: {
  workspaceId: string;
  postId: string;
  canEnqueue: boolean;
  postStatus: string;
}) {
  const [state, formAction, pending] = useActionState(enqueuePost, initialState);
  const locked = ["publishing", "cancelled", "published"].includes(postStatus);

  return (
    <form action={formAction} className="grid gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="postId" value={postId} />
      {state.message ? (
        <StatusBanner tone={state.status === "success" ? "success" : "warning"}>{state.message}</StatusBanner>
      ) : null}
      {canEnqueue && !locked ? (
        <Button disabled={pending}>{pending ? "Ставим в очередь..." : "Поставить в очередь"}</Button>
      ) : (
        <StatusBanner tone="info">
          {locked
            ? "Эта публикация уже в обработке, опубликована или отменена."
            : "В очередь можно поставить только согласованную текущую версию. Editor без approval отправить не может."}
        </StatusBanner>
      )}
    </form>
  );
}
