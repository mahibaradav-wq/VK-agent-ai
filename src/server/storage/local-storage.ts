import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { AccessError } from "@/modules/access/permissions";
import type { StorageDriver } from "@/server/storage/types";

export function createLocalStorage(rootDir: string): StorageDriver {
  return {
    driver: "local",
    ready: true,
    async put(key, bytes) {
      const fullPath = path.join(rootDir, key);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, bytes);
      return { key, driver: "local" };
    },
    async get(key) {
      try {
        return await readFile(path.join(rootDir, key));
      } catch {
        throw new AccessError(404, "Файл не найден в локальном хранилище.");
      }
    },
  };
}
