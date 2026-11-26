export const SECRET_LEAK_RE =
  /AUTH_SECRET|TOKEN_ENCRYPTION_KEY|BILLING_WEBHOOK_SECRET|YOOKASSA_SECRET_KEY|EMAIL_API_KEY|sk-|whsec_|polka_dev_password|Bearer [A-Za-z0-9._-]{8,}/;

export function assertAuthSecret(secret = process.env.AUTH_SECRET) {
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET должен содержать минимум 32 символа.");
  }
  if (/replace-with|changeme|secret123/i.test(secret)) {
    throw new Error("AUTH_SECRET не должен оставаться значением-заглушкой.");
  }
}

export function assertProductionCabinetGuards() {
  assertAuthSecret();
  const token = process.env.TOKEN_ENCRYPTION_KEY?.trim() ?? "";
  const secret = process.env.AUTH_SECRET?.trim() ?? "";
  if (token.length < 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY обязателен в production и должен содержать минимум 32 символа.");
  }
  if (token === secret) {
    throw new Error("TOKEN_ENCRYPTION_KEY должен отличаться от AUTH_SECRET.");
  }
  if (process.env.AUTH_DEV_MAILBOX === "true") {
    throw new Error("AUTH_DEV_MAILBOX нельзя включать в production.");
  }
  if (process.env.AI_LIVE_ENABLED === "true") {
    const limit = Number(process.env.AI_MONTHLY_HARD_LIMIT);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("AI_LIVE_ENABLED=true требует AI_MONTHLY_HARD_LIMIT как целое ≥ 1.");
    }
  }
}

export function assertNoSecretLeak(text: string, label = "response") {
  if (SECRET_LEAK_RE.test(text)) {
    throw new Error(`${label} содержит секрет или шаблон секрета.`);
  }
}

export function redactDiagnosticSecrets(raw: string): string {
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s@]+@/gi, "postgresql://[REDACTED]@")
    .replace(/rediss?:\/\/[^\s@]+@/gi, "redis://[REDACTED]@")
    .replace(/https?:\/\/[^\s@]+\/bot\d+:[A-Za-z0-9_-]{20,}/gi, "https://api.telegram.org/bot[REDACTED]")
    .replace(/\bbot\d{6,}:[A-Za-z0-9_-]{20,}\b/g, "bot[REDACTED_BOT_TOKEN]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9._-]{8,}\b/g, "sk-[REDACTED]")
    .replace(/\bwhsec_[A-Za-z0-9._-]{4,}\b/g, "whsec_[REDACTED]")
    .replace(/\bvk[12]\.[a-zA-Z0-9._-]{8,}\b/g, "vk.[REDACTED]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_BOT_TOKEN]")
    .replace(/polka_dev_password/g, "[REDACTED]")
    .replace(
      /(AUTH_SECRET|TOKEN_ENCRYPTION_KEY|BILLING_WEBHOOK_SECRET|YOOKASSA_SECRET_KEY|EMAIL_API_KEY|REDIS_URL|DATABASE_URL)\s*[=:]\s*\S+/gi,
      "$1=[REDACTED]",
    );
}
