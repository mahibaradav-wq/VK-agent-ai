import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://polka:polka_dev_password@localhost:5432/polka_social",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
