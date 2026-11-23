import http from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import { redactVkSecrets } from "@/modules/social/vk-manual";
import {
  createVkTransport,
  describeVkApiError,
  encodeMultipartFile,
  packVkTokens,
  resolveVkPublishTokens,
  unpackVkTokens,
} from "@/server/social/vk-api";

describe("VK token pack", () => {
  it("keeps a community key as-is and unpacks a photo user key", () => {
    expect(unpackVkTokens("vk1.a.community-only")).toEqual({ community: "vk1.a.community-only", photo: "" });
    const packed = packVkTokens("vk1.a.club", "vk1.a.admin");
    expect(packed.startsWith("polka-vk-v2:")).toBe(true);
    expect(unpackVkTokens(packed)).toEqual({ community: "vk1.a.club", photo: "vk1.a.admin" });
    expect(resolveVkPublishTokens(packed)).toEqual({ wall: "vk1.a.club", photo: "vk1.a.admin" });
    expect(resolveVkPublishTokens(packVkTokens("vk1.a.admin", "vk1.a.admin"))).toEqual({
      wall: "vk1.a.admin",
      photo: "vk1.a.admin",
    });
  });

  it("redacts access tokens from VK error text", () => {
    const token = `vk1.a.${"S".repeat(80)}`;
    expect(redactVkSecrets(`token ${token} leaked`)).not.toContain(token);
    expect(redactVkSecrets(packVkTokens(token, token))).toBe("polka-vk-v2:[redacted]");
    expect(
      describeVkApiError({
        ok: false,
        error_code: 5,
        error_msg: `invalid access_token ${token}`,
      }),
    ).not.toContain(token);
  });
});

describe("VK multipart upload", () => {
  it("posts a known-length typed array and does not set the forbidden Content-Length header", async () => {
    const encoded = encodeMultipartFile("file", {
      filename: "slide.png",
      mimeType: "image/png",
      bytes: new Uint8Array([1, 2, 3, 4]),
    });
    expect("content-length" in encoded.headers).toBe(false);
    expect(encoded.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    expect(encoded.body).toBeInstanceOf(Uint8Array);
    expect(Buffer.isBuffer(encoded.body)).toBe(false);
    expect(Buffer.from(encoded.body).includes(Buffer.from("slide.png"))).toBe(true);
    expect(Buffer.from(encoded.body).includes(Buffer.from([1, 2, 3, 4]))).toBe(true);

    let lengthHeader = "";
    let body: unknown;
    const transport = createVkTransport(async (_url, init) => {
      const headers = new Headers(init?.headers);
      lengthHeader = headers.get("content-length") ?? "";
      body = init?.body;
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
    expect(lengthHeader).toBe("");
    expect(body).toBeInstanceOf(Uint8Array);
    expect(Buffer.isBuffer(body)).toBe(false);
    expect((body as Uint8Array).byteLength).toBeGreaterThan(20);
  });

  it("uploads through node http with Content-Length so VK does not see chunked FormData", async () => {
    let lengthHeader = "";
    let received = 0;
    const server = http.createServer((req, res) => {
      lengthHeader = String(req.headers["content-length"] ?? "");
      req.on("data", (chunk) => {
        received += chunk.length;
      });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ file: "from-http" }));
      });
    });
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
    });
    try {
      const transport = createVkTransport();
      const uploaded = await transport.uploadDocument!(`http://127.0.0.1:${port}/doc`, {
        filename: "slide.png",
        mimeType: "image/png",
        bytes: new Uint8Array([1, 2, 3, 4]),
      });
      expect(uploaded.ok).toBe(true);
      if (uploaded.ok) {
        expect(uploaded.response.file).toBe("from-http");
      }
      expect(Number(lengthHeader)).toBe(received);
      expect(received).toBeGreaterThan(20);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
