"use client";

import { useActionState, useMemo, useState } from "react";

import { PostPreview } from "@/components/app/post-preview";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import { previewPlatforms } from "@/modules/posts/platforms";
import { savePostDraft, type PostFormState } from "@/modules/posts/actions";

type EditorMedia = {
  id: string;
  originalName: string;
  mimeType: string;
};

const initialState: PostFormState = { status: "idle", message: "" };

export function PostEditor({
  workspaceId,
  postId,
  versionNumber,
  title,
  body,
  platforms,
  media,
  selectedMediaIds,
  canEdit,
}: {
  workspaceId: string;
  postId: string;
  versionNumber: number;
  title: string;
  body: string;
  platforms: string[];
  media: EditorMedia[];
  selectedMediaIds: string[];
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(savePostDraft, initialState);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftBody, setDraftBody] = useState(body);
  const [draftPlatforms, setDraftPlatforms] = useState(platforms);
  const [draftMediaIds, setDraftMediaIds] = useState(selectedMediaIds);

  const previewUrls = useMemo(
    () => draftMediaIds.map((id) => `/api/media/${id}`),
    [draftMediaIds],
  );

  function toggle(list: string[], value: string) {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <Card>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Версия {versionNumber}</p>
        <form action={formAction} className="mt-4 grid gap-4">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="postId" value={postId} />
          {draftPlatforms.map((platform) => (
            <input key={platform} type="hidden" name="platform" value={platform} />
          ))}
          {draftMediaIds.map((id) => (
            <input key={id} type="hidden" name="mediaId" value={id} />
          ))}
          <label className="grid gap-2 text-sm font-medium text-ink">
            Название
            <input
              name="title"
              required
              disabled={!canEdit}
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-ink">
            Текст
            <textarea
              name="body"
              disabled={!canEdit}
              value={draftBody}
              onChange={(event) => setDraftBody(event.target.value)}
              className="min-h-48 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal"
            />
          </label>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium text-ink">Цели публикации</legend>
            {previewPlatforms.map((platform) => (
              <label key={platform.id} className="flex items-center gap-2 text-sm text-ink/80">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={draftPlatforms.includes(platform.id)}
                  onChange={() => setDraftPlatforms(toggle(draftPlatforms, platform.id))}
                />
                {platform.label}
              </label>
            ))}
            <p className="text-xs text-ink/60">Социальный аккаунт не подключается на этом этапе. Цель хранится как PostTarget в статусе draft.</p>
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium text-ink">Медиа</legend>
            {media.length === 0 ? <p className="text-sm text-ink/60">Сначала загрузите файл в медиатеке.</p> : null}
            {media.map((item) => (
              <label key={item.id} className="flex items-center gap-2 text-sm text-ink/80">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={draftMediaIds.includes(item.id)}
                  onChange={() => setDraftMediaIds(toggle(draftMediaIds, item.id))}
                />
                {item.originalName}
              </label>
            ))}
          </fieldset>
          {state.message ? (
            <StatusBanner tone={state.status === "success" ? "success" : "warning"}>{state.message}</StatusBanner>
          ) : null}
          {canEdit ? (
            <Button disabled={pending}>{pending ? "Сохраняем..." : "Сохранить черновик"}</Button>
          ) : (
            <StatusBanner tone="info">Текущая роль может только просматривать черновик.</StatusBanner>
          )}
        </form>
      </Card>
      <div>
        <p className="mb-3 text-sm font-semibold text-ink/70">Предпросмотр по собственным шаблонам</p>
        <PostPreview title={draftTitle} body={draftBody} platforms={draftPlatforms} mediaUrls={previewUrls} />
      </div>
    </div>
  );
}
