import { expect, test } from "@playwright/test";

import { registerVerifyAndLogin } from "./helpers";

test("register, verify from mailbox, enter cabinet, and stay out of admin", async ({ page }) => {
  const email = await registerVerifyAndLogin(page);
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole("link", { name: "Админка" })).toHaveCount(0);

  await page.goto("/admin");
  await expect(page.getByText("Недостаточно прав для админки")).toBeVisible();
  await expect(page.getByText("Обзор платформы")).toHaveCount(0);
});
