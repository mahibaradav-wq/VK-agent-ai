import { expect, test } from "@playwright/test";

import { SECRET_LEAK_RE } from "../src/server/security/secrets";

test("public pages and health do not leak secrets", async ({ request }) => {
  for (const path of ["/", "/login", "/register", "/pricing", "/features", "/api/health"]) {
    const response = await request.get(path);
    expect(response.ok(), path).toBeTruthy();
    const body = await response.text();
    expect(body, path).not.toMatch(SECRET_LEAK_RE);
  }
});

test("health reports the database without env values", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as { ok: boolean; db: string };
  expect(payload).toEqual({ ok: true, db: "up" });
});

test("security headers are present on the login page", async ({ request }) => {
  const response = await request.get("/login");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
});

test("protected routes redirect anonymous users to login", async ({ request }) => {
  for (const path of ["/app", "/admin"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect([302, 307, 308], path).toContain(response.status());
    expect(response.headers().location ?? "", path).toMatch(/login/);
  }
});

test("robots disallows private surfaces", async ({ request }) => {
  const body = await (await request.get("/robots.txt")).text();
  expect(body).toContain("Disallow: /app");
  expect(body).toContain("Disallow: /admin");
  expect(body).toContain("Disallow: /dev");
});
