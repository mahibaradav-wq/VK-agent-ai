import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { AccessError } from "@/modules/access/permissions";
import type { StorageDriver } from "@/server/storage/types";

type S3Options = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
};

export function createUnconfiguredStorage(label: string): StorageDriver {
  return {
    driver: "unconfigured",
    ready: false,
    setupMessage: `Загрузка в ${label} недоступна: требуется настройка интеграции.`,
    async put() {
      throw new AccessError(400, `Загрузка в ${label} недоступна: требуется настройка интеграции.`);
    },
    async get() {
      throw new AccessError(400, `Чтение из ${label} недоступно: требуется настройка интеграции.`);
    },
  };
}

export function createS3Storage(options: S3Options): StorageDriver {
  const client = new S3Client({
    region: options.region,
    endpoint: options.endpoint,
    forcePathStyle: options.forcePathStyle,
    credentials: {
      accessKeyId: options.accessKey,
      secretAccessKey: options.secretKey,
    },
  });

  return {
    driver: "s3",
    ready: true,
    async put(key, bytes, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
        }),
      );
      return { key, driver: "s3" };
    },
    async get(key) {
      try {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: options.bucket,
            Key: key,
          }),
        );
        const collected = await result.Body?.transformToByteArray();
        if (!collected) {
          throw new AccessError(404, "Файл не найден в S3.");
        }
        return collected;
      } catch (error) {
        if (error instanceof AccessError) {
          throw error;
        }
        throw new AccessError(404, "Файл не найден в S3.");
      }
    },
  };
}
