import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createLocalStorage } from "@/server/storage/local-storage";

describe("local storage path containment", () => {
  it("rejects path traversal on get and put", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "polka-storage-"));
    const storage = createLocalStorage(root);
    await expect(storage.put("../escape.bin", Buffer.from("x"), "application/octet-stream")).rejects.toBeInstanceOf(
      AccessError,
    );
    await expect(storage.get("../escape.bin")).rejects.toBeInstanceOf(AccessError);
    await expect(storage.get(path.join(root, "outside"))).rejects.toBeInstanceOf(AccessError);
  });

  it("reads keys that stay inside the root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "polka-storage-"));
    const storage = createLocalStorage(root);
    await storage.put("ws/file.bin", Buffer.from("ok"), "application/octet-stream");
    await expect(storage.get("ws/file.bin")).resolves.toEqual(Buffer.from("ok"));
    await writeFile(path.join(root, "ws", "direct.bin"), "direct");
    await expect(storage.get("ws/direct.bin")).resolves.toEqual(Buffer.from("direct"));
  });
});
