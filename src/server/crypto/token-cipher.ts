import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { AccessError } from "@/modules/access/permissions";

const ALGO = "aes-256-gcm";

export function getTokenKey() {
  const material = process.env.TOKEN_ENCRYPTION_KEY?.trim() || process.env.AUTH_SECRET?.trim();
  if (!material) {
    throw new AccessError(400, "Шифрование токенов недоступно: требуется настройка TOKEN_ENCRYPTION_KEY.");
  }
  return createHash("sha256").update(material).digest();
}

export function encryptToken(plaintext: string) {
  const key = getTokenKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${encrypted.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptToken(packed: string) {
  const [ivPart, dataPart, tagPart] = packed.split(".");
  if (!ivPart || !dataPart || !tagPart) {
    throw new AccessError(400, "Токен аккаунта повреждён.");
  }
  const key = getTokenKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]).toString("utf8");
}
