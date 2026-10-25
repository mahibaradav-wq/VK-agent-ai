"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/components/ui/status-banner";
import { enqueuePost, publishNowPost, type PublishFormState } from "@/modules/publishing/actions";

const initialState: PublishFormState = { status: "idle", message: "" };

export function EnqueueForm({
  workspaceId,
  postId,
  canEnqueue,
  canPublishNow,
  postStatus,
}: {
  workspaceId: string;
  postId: string;
  canEnqueue: boolean;
  canPublishNow: boolean;
  postStatus: string;
}) {
  const [state, formAction, pending] = useActionState(enqueuePost, initialState);
  const [nowState, nowAction, nowPending] = useActionState(publishNowPost, initialState);
  const locked = ["publishing", "cancelled", "published"].includes(postStatus);
  const message = nowState.message || state.message;
  const tone = nowState.status === "invalid" || state.status === "invalid" ? "warning" : "success";

  return (
    <div className="grid gap-3">
      {message ? <StatusBanner tone={tone}>{message}</StatusBanner> : null}
      {canPublishNow && !locked ? (
        <form action={nowAction} className="grid gap-3">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="postId" value={postId} />
          <Button disabled={nowPending}>{nowPending ? "Публикуем..." : "Опубликовать сейчас"}</Button>
        </form>
      ) : null}
      <form action={formAction} className="grid gap-3">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="postId" value={postId} />
        {canEnqueue && !locked ? (
          <Button disabled={pending} variant="secondary">
            {pending ? "Ставим в очередь..." : "Поставить в очередь"}
          </Button>
        ) : !canPublishNow || locked ? (
          <StatusBanner tone="info">
            {locked
              ? "Эта публикация уже в обработке, опубликована или отменена."
              : "В очередь можно поставить только согласованную текущую версию. Editor без approval отправить не может."}
          </StatusBanner>
        ) : null}
      </form>
    </div>
  );
}
