import { createPostService } from "@/modules/posts/post-service";
import { prisma } from "@/server/db/prisma";

function readField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function persistStudioDraftFromForm(userId: string, formData: FormData) {
  const title = readField(formData, "title");
  if (!title) {
    return;
  }
  await createPostService(prisma).saveDraft(userId, readField(formData, "workspaceId"), readField(formData, "postId"), {
    title,
    body: readField(formData, "body"),
    platforms: formData.getAll("platform").filter((value): value is string => typeof value === "string"),
    mediaIds: formData.getAll("mediaId").filter((value): value is string => typeof value === "string"),
  });
}
