import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";

function databaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL не задан.");
  }
  return new URL(raw);
}

describe("prisma migrations", () => {
  const source = databaseUrl();
  const dbName = `polka_migrate_${Date.now()}`;
  const migrateUrl = new URL(source.toString());
  migrateUrl.pathname = `/${dbName}`;
  const env = {
    ...process.env,
    PGPASSWORD: decodeURIComponent(source.password),
    DATABASE_URL: migrateUrl.toString(),
  };
  const sqlArgs = ["-h", source.hostname, "-p", source.port || "5432", "-U", decodeURIComponent(source.username)];

  afterAll(() => {
    try {
      execFileSync("psql", [...sqlArgs, "-d", "postgres", "-c", `DROP DATABASE IF EXISTS ${dbName}`], {
        env,
        stdio: "pipe",
      });
    } catch {
      // Пустая БД не должна оставлять хвост, но сбой очистки не маскирует сам тест.
    }
  });

  it("applies every committed migration to a clean database", () => {
    const expected = readdirSync("prisma/migrations").filter((name) => name !== "migration_lock.toml");
    execFileSync("psql", [...sqlArgs, "-d", "postgres", "-c", `CREATE DATABASE ${dbName}`], { env, stdio: "pipe" });
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env, stdio: "pipe" });

    const applied = execFileSync(
      "psql",
      [...sqlArgs, "-d", dbName, "-Atc", 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL'],
      { env, encoding: "utf8" },
    ).trim();

    expect(Number(applied)).toBe(expected.length);
    expect(expected.length).toBeGreaterThan(0);
  });
});
