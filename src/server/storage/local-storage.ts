import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { AccessError } from "@/modules/access/permissions";
import type { StorageDriver } from "@/server/storage/types";

function resolveContainedPath(rootDir: string, key: string) {
  if (!key || key.includes("\0") || path.isAbsolute(key)) {
    throw new AccessError(400, "Некорректный ключ локального хранилища.");
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, key);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (fullPath !== root && !fullPath.startsWith(prefix)) {
    throw new AccessError(400, "Ключ локального хранилища выходит за пределы каталога.");
  }
  return fullPath;
}

export function createLocalStorage(rootDir: string): StorageDriver {
  return {
    driver: "local",
    ready: true,
    async put(key, bytes) {
      const fullPath = resolveContainedPath(rootDir, key);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, bytes);
      return { key, driver: "local" };
    },
    async get(key) {
      try {
        return await readFile(resolveContainedPath(rootDir, key));
      } catch (error) {
        if (error instanceof AccessError) {
          throw error;
        }
        throw new AccessError(404, "Файл не найден в локальном хранилище.");
      }
    },
  };
}
