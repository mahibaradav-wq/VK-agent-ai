import path from "node:path";

import { createLocalStorage } from "@/server/storage/local-storage";
import { createS3Storage, createUnconfiguredStorage } from "@/server/storage/s3-storage";
import type { StorageDriver } from "@/server/storage/types";

export type { StorageDriver, StoredObject } from "@/server/storage/types";

export function createStorageFromEnv(): StorageDriver {
  const driver = process.env.STORAGE_DRIVER ?? "local";

  if (driver === "s3") {
    const bucket = process.env.S3_BUCKET?.trim();
    const accessKey = process.env.S3_ACCESS_KEY?.trim();
    const secretKey = process.env.S3_SECRET_KEY?.trim();

    if (!bucket || !accessKey || !secretKey) {
      return createUnconfiguredStorage("S3");
    }

    return createS3Storage({
      endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
      region: process.env.S3_REGION?.trim() || "us-east-1",
      bucket,
      accessKey,
      secretKey,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    });
  }

  return createLocalStorage(process.env.LOCAL_STORAGE_DIR ?? path.join(process.cwd(), "data/media"));
}

export const storage = createStorageFromEnv();
