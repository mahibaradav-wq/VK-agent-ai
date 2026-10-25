import { readFileSync } from "node:fs";

import { defineConfig } from "@playwright/test";

try {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
} catch {
  // Локальный .env не обязателен, если PLAYWRIGHT_BASE_URL задан снаружи.
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL:
      process.env.PLAYWRIGHT_BASE_URL ?? process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000",
    channel: "chrome",
  },
  webServer: {
    command: "npm start -- --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
