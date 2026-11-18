import { AccessError } from "@/modules/access/permissions";
import { draftInputFromForm } from "@/modules/posts/draft-fields";
import { createPostService } from "@/modules/posts/post-service";
import { prisma } from "@/server/db/prisma";

function readField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function persistStudioDraftFromForm(userId: string, formData: FormData) {
  const draft = draftInputFromForm(formData);
  const postId = readField(formData, "postId");
  if (!draft.title) {
    if (postId) {
      throw new AccessError(400, "Укажите заголовок перед сохранением или публикацией.");
    }
    return;
  }
  await createPostService(prisma).saveDraft(userId, readField(formData, "workspaceId"), postId, {
    title: draft.title,
    body: draft.body,
    platforms: draft.platforms,
    variants: draft.variants,
    mediaIds: draft.mediaIds,
  });
}
