import { AccessError } from "@/modules/access/permissions";
import {
  aiKinds,
  aiLengths,
  aiTones,
  type AiKind,
  type AiLength,
  type AiTone,
} from "@/server/ai/types";

export { aiKinds, aiLengths, aiTones };

export const kindLabels: Record<AiKind, string> = {
  ideas: "Идеи",
  post: "Пост",
  headline: "Заголовки",
  cta: "CTA",
  hashtags: "Хештеги",
};

export const toneLabels: Record<AiTone, string> = {
  neutral: "Нейтральный",
  friendly: "Дружелюбный",
  expert: "Экспертный",
  playful: "Игривый",
};

export const lengthLabels: Record<AiLength, string> = {
  short: "Короткий",
  medium: "Средний",
  long: "Длинный",
};

function pick<T extends string>(value: string, allowed: readonly T[], fallback: T, label: string): T {
  if (!value) {
    return fallback;
  }
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new AccessError(400, `Неизвестное значение ${label}.`);
}

export function parseKind(value: string): AiKind {
  return pick(value, aiKinds, "post", "типа генерации");
}

export function parseTone(value: string): AiTone {
  return pick(value, aiTones, "neutral", "тона");
}

export function parseLength(value: string): AiLength {
  return pick(value, aiLengths, "medium", "длины");
}

export function displayKind(kind: string) {
  if (kind === "agent") {
    return "Агент: пост + визуал";
  }
  if ((aiKinds as readonly string[]).includes(kind)) {
    return kindLabels[kind as AiKind];
  }
  return kind;
}
