"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/components/ui/status-banner";
import { uploadMedia, type MediaFormState } from "@/modules/media/actions";

const initialState: MediaFormState = { status: "idle", message: "" };

export function MediaUploadForm({ workspaceId, canUpload, setupMessage }: { workspaceId: string; canUpload: boolean; setupMessage?: string }) {
  const [state, formAction, pending] = useActionState(uploadMedia, initialState);

  if (!canUpload) {
    return <StatusBanner tone="info">Загружать файлы могут Editor, Admin и Owner.</StatusBanner>;
  }

  if (setupMessage) {
    return <StatusBanner tone="warning">{setupMessage}</StatusBanner>;
  }

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <label className="grid gap-2 text-sm font-medium text-ink">
        Файл
        <input
          name="file"
          type="file"
          required
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm"
        />
      </label>
      <p className="text-xs text-ink/60">JPEG, PNG, WEBP или GIF до 8 МБ. SVG, HTML и исполняемые файлы отклоняются.</p>
      {state.message ? (
        <StatusBanner tone={state.status === "success" ? "success" : "warning"}>{state.message}</StatusBanner>
      ) : null}
      <Button disabled={pending}>{pending ? "Загружаем..." : "Загрузить"}</Button>
    </form>
  );
}
