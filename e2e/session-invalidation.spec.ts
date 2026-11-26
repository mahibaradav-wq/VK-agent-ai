import { expect, test, type Browser } from "@playwright/test";

import { registerVerifyAndLogin } from "./helpers";

const NEW_PASSWORD = "brand-new-password-e2e";

async function resetPasswordInFreshContext(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/forgot-password");
  await page.locator('input[name="email"]').fill(email);
  await page.getByRole("button", { name: "Запросить восстановление" }).click();
  await page.waitForTimeout(500);

  await page.goto("/dev/mailbox?all=1");
  const card = page.locator(`[data-mail-to="${email}"][data-mail-kind="reset_password"]`).first();
  await expect(card).toBeVisible();
  await card.getByRole("link").first().click();
  await page.waitForURL(/\/reset-password\?token=/);
  await page.locator('input[name="password"]').fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Сохранить новый пароль" }).click();
  await expect(page.getByText("Пароль обновлён")).toBeVisible({ timeout: 15_000 });
  await context.close();
}

test("S1/S2: stale cookie is denied after reset, new login works", async ({ browser, request }) => {
  const oldContext = await browser.newContext();
  const oldPage = await oldContext.newPage();
  const email = await registerVerifyAndLogin(oldPage, "pr66");
  const oldCookies = await oldContext.cookies();
  const oldCookieHeader = oldCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  expect(oldCookies.some((cookie) => cookie.name.includes("session-token"))).toBe(true);

  await oldPage.goto("/app");
  await expect(oldPage.getByRole("heading", { name: "Дом по полочкам" })).toBeVisible();

  await resetPasswordInFreshContext(browser, email);

  await oldPage.goto("/app");
  await expect(oldPage).toHaveURL(/\/login/);
  expect(new URL(oldPage.url()).searchParams.get("session")).toBe("expired");

  const adminResponse = await request.get("/admin", {
    maxRedirects: 0,
    headers: { cookie: oldCookieHeader },
  });
  expect([302, 307, 308]).toContain(adminResponse.status());
  expect(adminResponse.headers().location ?? "").toMatch(/login/);

  const appResponse = await request.get("/app/studio", {
    maxRedirects: 0,
    headers: { cookie: oldCookieHeader },
  });
  expect([302, 307, 308]).toContain(appResponse.status());
  expect(appResponse.headers().location ?? "").toMatch(/login/);

  const apiResponse = await request.post("/api/ai/connect", {
    headers: { cookie: oldCookieHeader },
    multipart: { workspaceId: "ws", provider: "openai", apiKey: "sk-not-used" },
  });
  expect(apiResponse.status()).toBe(401);

  await oldContext.close();

  const newContext = await browser.newContext();
  const newPage = await newContext.newPage();
  await newPage.goto("/login");
  await newPage.locator('input[name="email"]').fill(email);
  await newPage.locator('input[name="password"]').fill(NEW_PASSWORD);
  await newPage.getByRole("button", { name: "Войти" }).click();
  await newPage.waitForURL(/\/app/, { timeout: 15_000 });
  await expect(newPage.getByRole("heading", { name: "Дом по полочкам" })).toBeVisible();

  await newPage.goto("/app/studio");
  await expect(newPage).toHaveURL(/\/app\/studio/);
  await newContext.close();
});

test("S5: public pages open and /login does not redirect-loop", async ({ page, request }) => {
  for (const path of ["/", "/pricing", "/register", "/forgot-password"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(200);
  }

  const response = await page.goto("/login?session=expired");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/login\?session=expired/);
  await expect(page.getByRole("button", { name: "Войти" })).toBeVisible();

  const check = await request.get("/api/auth/session-check", { maxRedirects: 0 });
  expect(check.status()).toBe(401);
  expect(await check.json()).toEqual({ valid: false });
  expect(check.headers()["cache-control"]).toContain("no-store");
});

test("S5: valid session is not falsely blocked across protected pages", async ({ page }) => {
  await registerVerifyAndLogin(page, "pr66-valid");
  for (const path of ["/app/studio", "/app/calendar", "/app"]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(path.replace("/", "\\/")));
  }
});

test("S5: spoofed Host header cannot redirect the session-check cookie", async ({ page, request }) => {
  await registerVerifyAndLogin(page, "pr66-host");
  const cookieHeader = (await page.context().cookies())
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");

  const response = await request.get("/app", {
    maxRedirects: 0,
    headers: { cookie: cookieHeader, host: "127.0.0.1:1" },
  });
  // Pinned origin means the spoofed host is irrelevant: the check still succeeds locally.
  expect(response.status()).toBe(200);
});
