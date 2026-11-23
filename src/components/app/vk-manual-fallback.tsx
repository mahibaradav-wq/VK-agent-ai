"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/components/ui/status-banner";
import { confirmManualVkPost, type PublishFormState } from "@/modules/publishing/actions";

const idle: PublishFormState = { status: "idle", message: "" };

export function VkManualFallback({
  workspaceId,
  postId,
  copy,
  mediaIds,
  canConfirm,
}: {
  workspaceId: string;
  postId: string;
  copy: string;
  mediaIds: string[];
  canConfirm: boolean;
}) {
  const [state, action, pending] = useActionState(confirmManualVkPost, idle);
  const [copied, setCopied] = useState(false);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(copy);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-2xl bg-sand-50 p-4 ring-1 ring-ink/10">
      <StatusBanner tone="warning">
        Telegram выходит сам. Во ВКонтакте ключ клуба не грузит новое фото на стену. Скачайте картинку, вставьте текст
        руками. Автоматический текст без картинки на стену не отправляем.
      </StatusBanner>
      {copy ? (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-2xl bg-white p-3 text-sm text-ink">{copy}</pre>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => void copyText()}>
          {copied ? "Текст скопирован" : "Скопировать текст для ВК"}
        </Button>
        {mediaIds.map((id, index) => (
          <a
            key={id}
            href={`/api/media/${id}?download=1`}
            className="inline-flex min-h-11 items-center rounded-2xl bg-white px-4 text-sm font-semibold text-brand-dark ring-1 ring-ink/10"
          >
            Скачать картинку{mediaIds.length > 1 ? ` ${index + 1}` : ""}
          </a>
        ))}
      </div>
      {state.message ? (
        <StatusBanner tone={state.status === "success" ? "success" : "warning"}>{state.message}</StatusBanner>
      ) : null}
      {canConfirm ? (
        <form action={action}>
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="postId" value={postId} />
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "Отмечаем..." : "Я выложил во ВК вручную"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
