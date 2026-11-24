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
