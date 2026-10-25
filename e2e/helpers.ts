import { expect, type Page } from "@playwright/test";

export async function registerVerifyAndLogin(page: Page, label = "e2e") {
  const email = `${label}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;

  await page.goto("/register");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await expect(page.getByText("Аккаунт создан")).toBeVisible({ timeout: 15_000 });

  await page.goto("/dev/mailbox");
  const verifyLink = page.locator(`[data-mail-to="${email}"]`).getByRole("link", { name: /открыть ссылку из письма/i });
  await expect(verifyLink).toBeVisible();
  await verifyLink.click();
  await expect(page.getByText("Email подтверждён. Теперь можно войти.")).toBeVisible({ timeout: 15_000 });

  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(/\/app/, { timeout: 15_000 });
  await expect(page.getByText(email)).toBeVisible();

  return email;
}
