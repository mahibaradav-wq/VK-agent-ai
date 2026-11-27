import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
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
  if (!fullPath.startsWith(prefix)) {
    throw new AccessError(400, "Ключ локального хранилища выходит за пределы каталога.");
  }
  return { root, fullPath };
}

async function assertRealContained(root: string, targetPath: string) {
  const rootReal = await realpath(root).catch(() => root);
  const rootPrefix = rootReal.endsWith(path.sep) ? rootReal : `${rootReal}${path.sep}`;
  // Check deepest existing ancestor so symlinks cannot redirect mkdir/writeFile outside root.
  let probe = targetPath;
  while (true) {
    try {
      const stat = await lstat(probe);
      if (stat.isSymbolicLink()) {
        throw new AccessError(400, "Символические ссылки в локальном хранилище запрещены.");
      }
      const real = await realpath(probe);
      if (real !== rootReal && !real.startsWith(rootPrefix)) {
        throw new AccessError(400, "Путь локального хранилища выходит за пределы каталога.");
      }
      break;
    } catch (error) {
      if (error instanceof AccessError) {
        throw error;
      }
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT") {
        throw error;
      }
      const parent = path.dirname(probe);
      if (parent === probe) {
        break;
      }
      probe = parent;
    }
  }
}

export function createLocalStorage(rootDir: string): StorageDriver {
  return {
    driver: "local",
    ready: true,
    async put(key, bytes) {
      const { root, fullPath } = resolveContainedPath(rootDir, key);
      await mkdir(root, { recursive: true });
      await assertRealContained(root, fullPath);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await assertRealContained(root, fullPath);
      await writeFile(fullPath, bytes);
      return { key, driver: "local" };
    },
    async get(key) {
      const { root, fullPath } = resolveContainedPath(rootDir, key);
      try {
        const rootReal = await realpath(root);
        const rootPrefix = rootReal.endsWith(path.sep) ? rootReal : `${rootReal}${path.sep}`;
        const stat = await lstat(fullPath);
        if (stat.isSymbolicLink()) {
          throw new AccessError(400, "Символические ссылки в локальном хранилище запрещены.");
        }
        const targetReal = await realpath(fullPath);
        if (!targetReal.startsWith(rootPrefix)) {
          throw new AccessError(400, "Путь локального хранилища выходит за пределы каталога.");
        }
        return await readFile(targetReal);
      } catch (error) {
        if (error instanceof AccessError) {
          throw error;
        }
        throw new AccessError(404, "Файл не найден в локальном хранилище.");
      }
    },
  };
}
