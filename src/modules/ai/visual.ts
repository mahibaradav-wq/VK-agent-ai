import { visualStyleRules, visualTargetPixels } from "@/modules/brand/visual-standard";
import type { AiImageSize } from "@/server/ai/types";

export const visualKinds = ["image", "video", "carousel", "infographic"] as const;
export type VisualKind = (typeof visualKinds)[number];

export const visualKindLabels: Record<VisualKind, string> = {
  image: "Изображение",
  video: "Видео",
  carousel: "Карусель",
  infographic: "Инфографика",
};

export const visualKindLive: Record<VisualKind, boolean> = {
  image: true,
  video: true,
  carousel: true,
  infographic: true,
};

export const visualAspects = ["1:1", "4:5", "16:9", "9:16"] as const;
export type VisualAspect = (typeof visualAspects)[number];

export const visualAspectsByKind: Record<VisualKind, readonly VisualAspect[]> = {
  image: ["1:1", "4:5", "16:9"],
  carousel: ["1:1", "4:5", "16:9"],
  infographic: ["1:1", "4:5", "16:9"],
  video: ["9:16", "16:9"],
};

const aspectSizes: Record<VisualAspect, AiImageSize> = {
  "1:1": "1024x1024",
  "4:5": "1024x1536",
  "16:9": "1536x1024",
  "9:16": "1024x1536",
};

const kindHints: Record<VisualKind, string> = {
  image: "Create one realistic photograph of a small kitchen or home storage scene.",
  video: "Create a still opening frame for a short vertical video of a real organizing action. This is a cover still, not an MP4.",
  carousel: "Create the cover slide of a carousel: one problem or useful result, empty space for later layout, identical frame to the rest of the set.",
  infographic: "Create one infographic card: one idea, large shapes, at most three short labels. Types allowed: steps, placement scheme, before/after, size table, checklist, storage zones, mistakes vs fixes.",
};

export function parseVisualKind(value: string): VisualKind {
  return (visualKinds as readonly string[]).includes(value) ? (value as VisualKind) : "image";
}

export function parseVisualAspect(value: string, kind?: VisualKind): VisualAspect {
  const allowed = kind ? visualAspectsByKind[kind] : visualAspects;
  if ((allowed as readonly string[]).includes(value)) {
    return value as VisualAspect;
  }
  return defaultVisualAspect(kind);
}

export function isVisualKindLive(kind: VisualKind) {
  return visualKindLive[kind];
}

export function imageSizeForAspect(aspect: VisualAspect): AiImageSize {
  return aspectSizes[aspect];
}

export function defaultVisualAspect(kind?: VisualKind): VisualAspect {
  return kind === "video" ? "9:16" : "4:5";
}

export function aspectLabel(aspect: VisualAspect) {
  const target = visualTargetPixels[aspect];
  return `${aspect} · ${target.width}×${target.height}`;
}

export function prepareVisualPrompt(input: {
  brief: string;
  kind?: string;
  aspect?: string;
  title?: string;
  body?: string;
}) {
  const kind = parseVisualKind(input.kind ?? "image");
  const aspect = parseVisualAspect(input.aspect ?? "", kind);
  const target = visualTargetPixels[aspect];
  const brief = input.brief.trim();
  return [
    visualStyleRules(),
    kindHints[kind],
    `User-facing format ${aspect}, target ${target.width}×${target.height} px (${target.label}). Keep the composition inside that frame.`,
    "The image model may receive a nearby size; compose as if the chosen ratio is final and do not put key objects on the edges.",
    input.title?.trim() ? `Topic: ${input.title.trim()}.` : "",
    input.body?.trim() ? `Context: ${input.body.trim().slice(0, 400)}.` : "",
    brief ? `User brief: ${brief.slice(0, 400)}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
