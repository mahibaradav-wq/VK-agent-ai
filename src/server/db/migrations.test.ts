import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { afterAll, describe, expect, it } from "vitest";

function refuseInheritedLibpq(env: NodeJS.ProcessEnv) {
  for (const key of Object.keys(env)) {
    if (key.startsWith("PG")) {
      throw new Error(`Migration test refuses inherited libpq environment (${key}).`);
    }
  }
}

async function assertLocalMaintenanceUrl(raw: string) {
  if (!raw) {
    throw new Error("DATABASE_URL не задан.");
  }
  if (raw.includes("?") || raw.includes("#")) {
    throw new Error("DATABASE_URL must not include query parameters.");
  }
  const source = new URL(raw);
  if (source.protocol !== "postgresql:" && source.protocol !== "postgres:") {
    throw new Error("DATABASE_URL scheme is not allowed.");
  }
  const host = source.hostname;
  const port = source.port || "5432";
  const user = decodeURIComponent(source.username);
  const database = source.pathname.replace(/^\//, "");
  if (port !== "5432") {
    throw new Error("DATABASE_URL port is not allowed.");
  }
  if (user !== "polka") {
    throw new Error("DATABASE_URL user is not allowed.");
  }
  if (database !== "postgres" && database !== "polka_social") {
    throw new Error("DATABASE_URL database is not a local maintenance database.");
  }
  if (isIP(host)) {
    if (host !== "127.0.0.1" && host !== "::1" && !host.startsWith("127.")) {
      throw new Error("DATABASE_URL host is not a loopback address.");
    }
  } else if (host === "localhost" || host === "postgres") {
    const results = await lookup(host, { all: true });
    for (const entry of results) {
      const ip = entry.address;
      if (ip !== "127.0.0.1" && ip !== "::1" && !ip.startsWith("127.")) {
        throw new Error("DATABASE_URL host does not resolve only to loopback.");
      }
    }
  } else {
    throw new Error("DATABASE_URL host is not on the isolated allowlist.");
  }
  return source;
}

describe("prisma migrations", () => {
  let source: URL;
  let dbName = "";
  let migrateUrl = "";
  let sqlArgs: string[] = [];
  let password = "";

  afterAll(() => {
    if (!dbName || !source) {
      return;
    }
    try {
      const maintenanceDb = source.pathname.replace(/^\//, "") || "postgres";
      const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: process.env.LANG,
        NODE_ENV: process.env.NODE_ENV,
        PGPASSWORD: password,
      };
      execFileSync("psql", [...sqlArgs, "-d", maintenanceDb, "-c", `DROP DATABASE IF EXISTS ${dbName}`], {
        env,
        stdio: "pipe",
      });
    } catch {
      // Пустая БД не должна оставлять хвост, но сбой очистки не маскирует сам тест.
    }
  });

  it("applies every committed migration to a clean database", async () => {
    refuseInheritedLibpq(process.env);
    source = await assertLocalMaintenanceUrl(process.env.DATABASE_URL ?? "");
    password = decodeURIComponent(source.password);
    dbName = `polka_migrate_${Date.now()}`;
    const next = new URL(source.toString());
    next.pathname = `/${dbName}`;
    migrateUrl = next.toString();
    sqlArgs = ["-h", source.hostname, "-p", source.port || "5432", "-U", decodeURIComponent(source.username)];
    const maintenanceDb = source.pathname.replace(/^\//, "") || "postgres";

    const expected = readdirSync("prisma/migrations").filter((name) => name !== "migration_lock.toml");
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: process.env.LANG,
      NODE_ENV: process.env.NODE_ENV,
      PGPASSWORD: password,
      DATABASE_URL: migrateUrl,
      npm_config_cache: process.env.npm_config_cache,
      NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE,
    };
    execFileSync("npx", ["prisma", "validate"], { env, stdio: "pipe" });
    execFileSync("psql", [...sqlArgs, "-d", maintenanceDb, "-c", `CREATE DATABASE ${dbName}`], {
      env,
      stdio: "pipe",
    });
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env, stdio: "pipe" });
    // Second deploy must be idempotent
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env, stdio: "pipe" });

    const applied = execFileSync(
      "psql",
      [...sqlArgs, "-d", dbName, "-Atc", 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL'],
      { env, encoding: "utf8" },
    ).trim();

    expect(Number(applied)).toBe(expected.length);
    expect(expected.length).toBeGreaterThan(0);

    // Verify deployed schema structure (tables, FKs, unique indexes, indexes) and zero drift
    const counts = execFileSync(
      "psql",
      [
        ...sqlArgs,
        "-d",
        dbName,
        "-Atc",
        [
          "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';",
          "SELECT count(*) FROM information_schema.table_constraints WHERE table_schema='public' AND constraint_type='FOREIGN KEY';",
          "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexdef LIKE 'CREATE UNIQUE INDEX%';",
          "SELECT count(*) FROM pg_indexes WHERE schemaname='public';",
        ].join(" "),
      ],
      { env, encoding: "utf8" },
    )
      .trim()
      .split(/\s+/)
      .map(Number);

    expect(counts[0]).toBeGreaterThanOrEqual(41);
    expect(counts[1]).toBeGreaterThanOrEqual(71);
    expect(counts[2]).toBeGreaterThanOrEqual(70);
    expect(counts[3]).toBeGreaterThanOrEqual(98);

    // Deployed DB schema must match prisma/schema.prisma with zero unplanned changes
    execFileSync(
      "npx",
      [
        "prisma",
        "migrate",
        "diff",
        "--from-schema-datasource",
        "prisma/schema.prisma",
        "--to-schema-datamodel",
        "prisma/schema.prisma",
        "--exit-code",
      ],
      { env, stdio: "pipe" },
    );
  });
});
