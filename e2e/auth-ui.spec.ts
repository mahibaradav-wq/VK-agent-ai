import { expect, test } from "@playwright/test";

test("register, verify from mailbox, enter cabinet, and stay out of admin", async ({ page }) => {
  const email = `e2e.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;

  await page.goto("/register");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await expect(page.getByText("Аккаунт создан")).toBeVisible({ timeout: 15_000 });

  await page.goto("/dev/mailbox");
  const verifyLink = page
    .locator("article, section, div")
    .filter({ hasText: email })
    .getByRole("link", { name: /открыть ссылку из письма/i })
    .first();
  await expect(verifyLink).toBeVisible();
  await verifyLink.click();
  await expect(page.getByText("Email подтверждён. Теперь можно войти.")).toBeVisible({ timeout: 15_000 });

  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(/\/app/, { timeout: 15_000 });
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole("link", { name: "Админка" })).toHaveCount(0);

  await page.goto("/admin");
  await expect(page.getByText("Недостаточно прав для админки")).toBeVisible();
  await expect(page.getByText("Обзор платформы")).toHaveCount(0);
});
