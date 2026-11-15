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
  const [draftPlatforms, setDraftPlatforms] = useState(platforms.length > 0 ? platforms : ["telegram"]);
  const [draftMediaIds, setDraftMediaIds] = useState(selectedMediaIds);

  const previewUrls = useMemo(
    () => draftMediaIds.map((id) => `/api/media/${id}`),
    [draftMediaIds],
  );
  const attachedMedia = media.filter((item) => draftMediaIds.includes(item.id));
  const libraryMedia = media.filter((item) => !draftMediaIds.includes(item.id));

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
            {previewPlatforms.map((platform) => {
              const checked = draftPlatforms.includes(platform.id);
              return (
                <label key={platform.id} className="flex items-center gap-2 text-sm text-ink/80">
                  <input
                    type="checkbox"
                    disabled={!canEdit || (!platform.live && !checked)}
                    checked={checked}
                    onChange={() => setDraftPlatforms(toggle(draftPlatforms, platform.id))}
                  />
                  {platform.live ? platform.label : `${platform.label} (пока нельзя)`}
                </label>
              );
            })}
            <p className="text-xs text-ink/60">
              Живая публикация — Telegram и стена ВК. Для ВК нужен ключ сообщества с правом «Стена» на странице аккаунтов.
              Сервисный ключ приложения и пароль не подходят.
            </p>
          </fieldset>
          <fieldset className="grid gap-3">
            <legend className="text-sm font-medium text-ink">Визуал этого черновика</legend>
            {attachedMedia.length === 0 ? (
              <p className="text-sm text-ink/60">
                К этому черновику картинка не приложена. Файлы ниже — из медиатеки других постов, сами они не
                подставляются.
              </p>
            ) : null}
            {attachedMedia.map((item) => (
              <label key={item.id} className="flex items-center gap-3 text-sm text-ink/80">
                {item.mimeType.startsWith("image/") ? (
                  <img src={`/api/media/${item.id}`} alt="" className="h-14 w-14 rounded-xl object-cover" />
                ) : null}
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked
                  onChange={() => setDraftMediaIds(toggle(draftMediaIds, item.id))}
                />
                {item.originalName}
              </label>
            ))}
            {libraryMedia.length > 0 ? (
              <div className="grid gap-2 rounded-2xl bg-sand-50 p-3">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Медиатека, не этот пост</p>
                <p className="text-xs text-ink/60">Отметьте файл, только если хотите приложить его вместо нового визуала.</p>
                {libraryMedia.map((item) => (
                  <label key={item.id} className="flex items-center gap-2 text-sm text-ink/70">
                    <input
                      type="checkbox"
                      disabled={!canEdit}
                      checked={false}
                      onChange={() => setDraftMediaIds(toggle(draftMediaIds, item.id))}
                    />
                    {item.originalName}
                  </label>
                ))}
              </div>
            ) : media.length === 0 ? (
              <p className="text-sm text-ink/60">Сначала загрузите файл в медиатеке.</p>
            ) : null}
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
