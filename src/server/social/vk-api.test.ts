import { describe, expect, it } from "vitest";

import { createVkTransport, encodeMultipartFile } from "@/server/social/vk-api";

describe("VK multipart upload", () => {
  it("sends a known content-length instead of chunked FormData", async () => {
    const encoded = encodeMultipartFile("file", {
      filename: "slide.png",
      mimeType: "image/png",
      bytes: new Uint8Array([1, 2, 3, 4]),
    });
    expect(encoded.headers["content-length"]).toBe(String(encoded.body.length));
    expect(encoded.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    expect(encoded.body.includes(Buffer.from("slide.png"))).toBe(true);
    expect(encoded.body.includes(Buffer.from([1, 2, 3, 4]))).toBe(true);

    let length = "";
    let bodyIsBuffer = false;
    const transport = createVkTransport(async (_url, init) => {
      const headers = new Headers(init?.headers);
      length = headers.get("content-length") ?? "";
      bodyIsBuffer = Buffer.isBuffer(init?.body) || init?.body instanceof Uint8Array;
      return new Response(JSON.stringify({ file: "doc-payload" }), { status: 200 });
    });
    const uploaded = await transport.uploadDocument!("https://upload.vk.test/doc", {
      filename: "slide.png",
      mimeType: "image/png",
      bytes: new Uint8Array([1, 2, 3, 4]),
    });
    expect(uploaded.ok).toBe(true);
    if (uploaded.ok) {
      expect(uploaded.response.file).toBe("doc-payload");
    }
    expect(Number(length)).toBeGreaterThan(20);
    expect(bodyIsBuffer).toBe(true);
  });
});
