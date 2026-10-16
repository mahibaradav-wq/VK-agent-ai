import { AccessError } from "@/modules/access/permissions";

export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

export const allowedMediaTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export type AllowedMediaType = (typeof allowedMediaTypes)[number];

const magicChecks: Array<{ mime: AllowedMediaType; match: (bytes: Uint8Array) => boolean }> = [
  {
    mime: "image/jpeg",
    match: (bytes) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    mime: "image/png",
    match: (bytes) =>
      bytes.length > 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a,
  },
  {
    mime: "image/gif",
    match: (bytes) => {
      const header = Buffer.from(bytes.slice(0, 6)).toString("ascii");
      return header === "GIF87a" || header === "GIF89a";
    },
  },
  {
    mime: "image/webp",
    match: (bytes) =>
      bytes.length > 12 &&
      Buffer.from(bytes.slice(0, 4)).toString("ascii") === "RIFF" &&
      Buffer.from(bytes.slice(8, 12)).toString("ascii") === "WEBP",
  },
];

function looksLikeTextOrMarkup(bytes: Uint8Array) {
  const head = Buffer.from(bytes.slice(0, 256)).toString("utf8").trim().toLowerCase();
  return (
    head.startsWith("<svg") ||
    head.startsWith("<?xml") ||
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.startsWith("<script")
  );
}

export function detectMediaType(bytes: Uint8Array): AllowedMediaType | null {
  const found = magicChecks.find((check) => check.match(bytes));
  return found?.mime ?? null;
}

export function validateMediaFile(input: { bytes: Uint8Array; filename: string; declaredType?: string }) {
  if (input.bytes.byteLength === 0) {
    throw new AccessError(400, "Пустой файл нельзя загрузить.");
  }

  if (input.bytes.byteLength > MAX_MEDIA_BYTES) {
    throw new AccessError(400, "Файл больше 8 МБ.");
  }

  if (looksLikeTextOrMarkup(input.bytes)) {
    throw new AccessError(400, "Этот тип файла не поддерживается.");
  }

  const detected = detectMediaType(input.bytes);
  if (!detected) {
    throw new AccessError(400, "Этот тип файла не поддерживается.");
  }

  if (input.declaredType && input.declaredType !== detected && input.declaredType !== "application/octet-stream") {
    throw new AccessError(400, "Заявленный MIME не совпадает с содержимым файла.");
  }

  const extension = input.filename.split(".").pop()?.toLowerCase();
  const extensionMap: Record<AllowedMediaType, string[]> = {
    "image/jpeg": ["jpg", "jpeg"],
    "image/png": ["png"],
    "image/webp": ["webp"],
    "image/gif": ["gif"],
  };

  if (extension && !extensionMap[detected].includes(extension)) {
    throw new AccessError(400, "Расширение файла не соответствует содержимому.");
  }

  return { mimeType: detected, sizeBytes: input.bytes.byteLength };
}
