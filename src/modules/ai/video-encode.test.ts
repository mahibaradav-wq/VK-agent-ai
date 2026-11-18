import { describe, expect, it } from "vitest";

import { detectMediaType } from "@/modules/media/file-validation";
import { encodeSlideshowMp4, videoPixels } from "@/modules/ai/video-encode";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("studio video encode", () => {
  it("sizes vertical clips to 720x1280", () => {
    expect(videoPixels("9:16")).toEqual({ width: 720, height: 1280 });
    expect(videoPixels("16:9")).toEqual({ width: 1280, height: 720 });
  });

  it("builds a real MP4 from ChatGPT stills", async () => {
    const bytes = await encodeSlideshowMp4({
      frames: [png, png],
      seconds: 4,
      aspect: "9:16",
    });
    expect(detectMediaType(bytes)).toBe("video/mp4");
    expect(bytes.byteLength).toBeGreaterThan(32);
  });
});
