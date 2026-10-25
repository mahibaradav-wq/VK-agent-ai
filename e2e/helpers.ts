import { expect, type Page } from "@playwright/test";

export async function registerVerifyAndLogin(page: Page, label = "e2e") {
  const email = `${label}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;

  await page.goto("/register");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await expect(page.getByText("Аккаунт создан")).toBeVisible({ timeout: 15_000 });

  await page.goto("/dev/mailbox?all=1");
  const verifyButton = page
    .locator(`[data-mail-to="${email}"]`)
    .getByRole("button", { name: /подтвердить email и открыть вход/i });
  await expect(verifyButton).toBeVisible();
  await verifyButton.click();
  await expect(page.getByText("Email подтверждён")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Войти" })).toBeVisible();

  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(/\/app/, { timeout: 15_000 });
  await expect(page.getByText(email)).toBeVisible();

  return email;
}
