import { expect, test } from "@playwright/test";

import { registerVerifyAndLogin } from "./helpers";

test("cabinet pages work and subscription stays unpaid without YooKassa", async ({ page }) => {
  await registerVerifyAndLogin(page, "e2e.cabinet");
  await expect(page.getByRole("link", { name: "Админка" })).toHaveCount(0);

  await page.goto("/app/projects");
  await page.locator('input[name="name"]').fill("Проект ручной проверки");
  await page.getByRole("button", { name: "Создать проект" }).click();
  await expect(page.getByRole("heading", { name: "Проект ручной проверки" })).toBeVisible({ timeout: 15_000 });

  await page.goto("/app/posts");
  await page.getByRole("button", { name: "Новый черновик" }).click();
  await page.waitForURL(/\/app\/posts\//, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Сохранить черновик" })).toBeVisible();

  await page.goto("/app/social-accounts");
  await expect(page.getByText(/без токена публикация не имитируется/i)).toBeVisible();

  await page.goto("/app/ai");
  await expect(page.getByText(/без ключа генерация не имитируется/i)).toBeVisible();

  await page.goto("/app/calendar");
  await expect(page.getByText("Календарь").first()).toBeVisible();

  await page.goto("/app/queue");
  await expect(page.getByRole("heading", { name: "Автопостинг" })).toBeVisible();

  await page.goto("/app/subscription");
  await expect(page.getByText(/YOOKASSA_SHOP_ID/)).toBeVisible();
  await expect(page.getByText(/не оплачена/i)).toBeVisible();
  await expect(page.getByText(/оплачена ·/i)).toHaveCount(0);

  await page.goto("/admin");
  await expect(page.getByText("Недостаточно прав для админки")).toBeVisible();
});
