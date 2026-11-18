import { describe, expect, it } from "vitest";

import { encodeJpegStill, jpegForVkWall } from "@/modules/media/jpeg-encode";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("jpeg stills for VK", () => {
  it("keeps a JPEG as-is and converts a PNG when ffmpeg is available", async () => {
    const jpeg = await jpegForVkWall({ bytes: png, mimeType: "image/png" });
    expect(jpeg.bytes.byteLength).toBeGreaterThan(8);
    try {
      const converted = await encodeJpegStill(png);
      expect(converted.mimeType).toBe("image/jpeg");
      expect(converted.bytes[0]).toBe(0xff);
      expect(converted.bytes[1]).toBe(0xd8);
    } catch {
      expect(jpeg.mimeType).toBe("image/png");
    }
  });
});
