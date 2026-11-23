import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { AccessError } from "@/modules/access/permissions";

const ALGO = "aes-256-gcm";

function deriveKey(material: string) {
  return createHash("sha256").update(material).digest();
}

function configuredEncryptionMaterial() {
  const dedicated = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (dedicated) return dedicated;

  if (process.env.NODE_ENV !== "production") {
    const developmentFallback = process.env.AUTH_SECRET?.trim();
    if (developmentFallback) return developmentFallback;
  }

  throw new AccessError(
    400,
    "Шифрование токенов недоступно: задайте отдельный TOKEN_ENCRYPTION_KEY.",
  );
}

function decryptionKeys() {
  const materials = [
    process.env.TOKEN_ENCRYPTION_KEY?.trim(),
    process.env.AUTH_SECRET?.trim(),
  ].filter((value): value is string => Boolean(value));
  const unique = [...new Set(materials)];
  if (unique.length === 0) {
    throw new AccessError(400, "Расшифровка токенов недоступна: ключ не настроен.");
  }
  return unique.map(deriveKey);
}

export function encryptToken(plaintext: string) {
  const key = deriveKey(configuredEncryptionMaterial());
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${encrypted.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptToken(packed: string) {
  const [ivPart, dataPart, tagPart, ...extra] = packed.split(".");
  if (!ivPart || !dataPart || !tagPart || extra.length > 0) {
    throw new AccessError(400, "Токен аккаунта повреждён.");
  }

  const iv = Buffer.from(ivPart, "base64url");
  const data = Buffer.from(dataPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  if (iv.length !== 12 || tag.length !== 16) {
    throw new AccessError(400, "Токен аккаунта повреждён.");
  }

  for (const key of decryptionKeys()) {
    try {
      const decipher = createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    } catch {
      // Try the legacy AUTH_SECRET key after the dedicated encryption key.
    }
  }
  throw new AccessError(400, "Не удалось расшифровать токен аккаунта. Проверьте TOKEN_ENCRYPTION_KEY.");
}
