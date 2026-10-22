export const SECRET_LEAK_RE =
  /AUTH_SECRET|TOKEN_ENCRYPTION_KEY|BILLING_WEBHOOK_SECRET|EMAIL_API_KEY|sk-|whsec_|polka_dev_password|Bearer [A-Za-z0-9._-]{8,}/;

export function assertAuthSecret(secret = process.env.AUTH_SECRET) {
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET должен содержать минимум 32 символа.");
  }
  if (/replace-with|changeme|secret123/i.test(secret)) {
    throw new Error("AUTH_SECRET не должен оставаться значением-заглушкой.");
  }
}

export function assertNoSecretLeak(text: string, label = "response") {
  if (SECRET_LEAK_RE.test(text)) {
    throw new Error(`${label} содержит секрет или шаблон секрета.`);
  }
}
