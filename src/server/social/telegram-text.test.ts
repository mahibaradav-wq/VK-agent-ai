import { describe, expect, it } from "vitest";

import {
  TELEGRAM_CAPTION_LIMIT,
  TELEGRAM_MESSAGE_LIMIT,
  splitTelegramText,
  telegramCaptionAndRest,
  telegramPhotoCaption,
} from "@/server/social/telegram-text";

describe("telegram text limits", () => {
  it("keeps a short post as one caption", () => {
    expect(telegramCaptionAndRest("Полки без хаоса.")).toEqual({ caption: "Полки без хаоса.", rest: "" });
  });

  it("splits a long body so Telegram captions stay under 1024", () => {
    const text = `${"А".repeat(800)}\n\n${"Б".repeat(900)}`;
    const { caption, rest } = telegramCaptionAndRest(text);
    expect(caption.length).toBeLessThanOrEqual(TELEGRAM_CAPTION_LIMIT);
    expect(caption.startsWith("А")).toBe(true);
    expect(rest.startsWith("Б")).toBe(true);
    expect(`${caption}\n\n${rest}`).toBe(text);
    expect(telegramPhotoCaption(text)).toBe(caption);
  });

  it("splits a 5000-character post into Telegram-sized messages", () => {
    const text = "Знак".repeat(1250);
    const chunks = splitTelegramText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= TELEGRAM_MESSAGE_LIMIT)).toBe(true);
    expect(chunks.join("")).toBe(text);
  });
});
