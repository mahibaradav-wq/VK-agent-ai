import { parsePlatforms, type PreviewPlatformId } from "@/modules/posts/platforms";

export type PlatformCopy = {
  title: string;
  body: string;
};

export type PlatformVariants = Partial<Record<PreviewPlatformId, PlatformCopy>>;

export function parseVariants(raw?: string | null): PlatformVariants {
  if (!raw?.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const variants: PlatformVariants = {};
    for (const platform of parsePlatforms(Object.keys(parsed))) {
      const item = (parsed as Record<string, unknown>)[platform];
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }
      const title = typeof (item as { title?: unknown }).title === "string" ? (item as { title: string }).title.trim() : "";
      const body = typeof (item as { body?: unknown }).body === "string" ? (item as { body: string }).body.trim() : "";
      if (title || body) {
        variants[platform] = { title, body };
      }
    }
    return variants;
  } catch {
    return {};
  }
}

export function serializeVariants(variants: PlatformVariants) {
  return JSON.stringify(variants);
}

export function copyForPlatform(
  version: { title: string; body: string; variantsJson?: string | null },
  platform: string,
): PlatformCopy {
  const variants = parseVariants(version.variantsJson);
  const hit = variants[platform as PreviewPlatformId];
  if (hit && (hit.title || hit.body)) {
    return {
      title: hit.title || version.title,
      body: hit.body || version.body,
    };
  }
  return { title: version.title, body: version.body };
}

export function variantsFromCopies(
  platforms: string[],
  copies: PlatformVariants,
  fallback: PlatformCopy,
): PlatformVariants {
  const variants: PlatformVariants = {};
  for (const platform of parsePlatforms(platforms)) {
    const hit = copies[platform];
    variants[platform] = {
      title: hit?.title?.trim() || fallback.title,
      body: hit?.body?.trim() || fallback.body,
    };
  }
  return variants;
}

export function primaryCopy(platforms: string[], copies: PlatformVariants, fallback: PlatformCopy): PlatformCopy {
  const first = parsePlatforms(platforms)[0];
  if (!first) {
    return fallback;
  }
  return copies[first] ?? fallback;
}
