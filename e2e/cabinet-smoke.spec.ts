import { expect, test } from "@playwright/test";

import { registerVerifyAndLogin } from "./helpers";

test("cabinet pages follow the approved menu", async ({ page }) => {
  await registerVerifyAndLogin(page, "e2e.cabinet");
  await expect(page.getByRole("link", { name: "Админка" })).toHaveCount(0);

  await expect(page.getByRole("navigation", { name: "Кабинет" }).getByRole("link", { name: "Проекты" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Кабинет" }).getByRole("link", { name: "Студия" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Кабинет" }).getByRole("link", { name: "Товары" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Публикации" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Подписка" })).toHaveCount(0);

  await page.locator('input[name="name"]').fill("Проект ручной проверки");
  await page.getByRole("button", { name: "Создать проект" }).click();
  await expect(page.getByRole("heading", { name: "Проект ручной проверки" })).toBeVisible({ timeout: 15_000 });

  await page.goto("/app/connections");
  await expect(page.getByText(/без токена публикация не имитируется/i)).toBeVisible();

  await page.goto("/app/studio");
  await expect(page.getByRole("heading", { name: "Пост + визуал" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Сгенерировать текст" })).toHaveCount(0);
  await page.getByRole("button", { name: "Карусель" }).click();
  await expect(page.getByText("Карточек в посте")).toBeVisible();

  await page.goto("/app/ai");
  await expect(page).toHaveURL(/\/app\/studio/);

  await page.goto("/app/products");
  await expect(page.getByText(/Ozon, Wildberries/i)).toBeVisible();

  await page.goto("/app/calendar");
  await expect(page.getByText("Календарь").first()).toBeVisible();
  await expect(page.getByText(/Запланировано:/)).toBeVisible();

  await page.goto("/app/subscription");
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/admin");
  await expect(page.getByText("Недостаточно прав для админки")).toBeVisible();
});
