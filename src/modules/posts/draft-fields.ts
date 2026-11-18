import { parsePlatforms } from "@/modules/posts/platforms";
import { primaryCopy, variantsFromCopies, type PlatformCopy, type PlatformVariants } from "@/modules/posts/variants";

function readField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function draftInputFromForm(formData: FormData) {
  const platforms = parsePlatforms(
    formData.getAll("platform").filter((value): value is string => typeof value === "string"),
  );
  const fallback: PlatformCopy = {
    title: readField(formData, "title"),
    body: readField(formData, "body"),
  };
  const copies: PlatformVariants = {
    telegram: {
      title: readField(formData, "telegramTitle") || fallback.title,
      body: readField(formData, "telegramBody") || fallback.body,
    },
    vk: {
      title: readField(formData, "vkTitle") || (platforms.includes("telegram") ? "" : fallback.title),
      body: readField(formData, "vkBody") || (platforms.includes("telegram") ? "" : fallback.body),
    },
  };
  const variants = variantsFromCopies(platforms, copies, fallback);
  const primary = primaryCopy(platforms, variants, fallback);
  return {
    title: primary.title,
    body: primary.body,
    platforms,
    variants,
    mediaIds: formData.getAll("mediaId").filter((value): value is string => typeof value === "string"),
  };
}
