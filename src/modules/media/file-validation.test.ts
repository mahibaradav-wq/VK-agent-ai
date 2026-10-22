import { describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { detectMediaType, validateMediaFile } from "@/modules/media/file-validation";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("media file validation", () => {
  it("accepts a real PNG", () => {
    const result = validateMediaFile({ bytes: png, filename: "shot.png", declaredType: "image/png" });
    expect(result.mimeType).toBe("image/png");
    expect(detectMediaType(png)).toBe("image/png");
  });

  it("rejects HTML disguised as an image", () => {
    const html = Buffer.from("<!doctype html><script>alert(1)</script>");
    expect(() => validateMediaFile({ bytes: html, filename: "shot.png", declaredType: "image/png" })).toThrow(
      AccessError,
    );
    expect(() => validateMediaFile({ bytes: html, filename: "shot.png", declaredType: "image/png" })).toThrow(
      /не поддерживается/,
    );
  });

  it("rejects SVG and empty files", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(() => validateMediaFile({ bytes: svg, filename: "icon.svg" })).toThrow(/не поддерживается/);
    expect(() => validateMediaFile({ bytes: new Uint8Array(), filename: "empty.png" })).toThrow(/Пустой файл/);
  });
});
