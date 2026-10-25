import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("production hosting stack", () => {
  const dockerfile = read("Dockerfile");
  const compose = read("docker-compose.prod.yml");
  const caddy = read("deploy/Caddyfile");
  const envExample = read(".env.production.example");
  const deploy = read("docs/deploy.md");
  const upScript = read("scripts/vps-up.sh");

  it("builds the app image and applies migrations before start", () => {
    expect(dockerfile).toContain("npx prisma generate && npm run build");
    expect(dockerfile).toContain("npx prisma migrate deploy");
    expect(dockerfile).toContain("npm start -- --hostname 0.0.0.0 --port 3000");
  });

  it("exposes HTTPS via Caddy on a real domain", () => {
    expect(compose).toContain("caddy:2-alpine");
    expect(compose).toContain('"80:80"');
    expect(compose).toContain('"443:443"');
    expect(compose).toContain("SITE_DOMAIN");
    expect(caddy).toContain("reverse_proxy app:3000");
    expect(caddy).toContain("{$SITE_DOMAIN}");
    expect(caddy).toContain("Strict-Transport-Security");
  });

  it("keeps production secrets out of git and blocks the mailbox stand", () => {
    expect(envExample).toContain("SITE_DOMAIN=");
    expect(envExample).toContain("AUTH_SECRET=");
    expect(envExample).toContain("POSTGRES_PASSWORD=");
    expect(envExample).toMatch(/# AUTH_DEV_MAILBOX=/);
    expect(envExample).not.toMatch(/^AUTH_DEV_MAILBOX=true$/m);
    expect(upScript).toContain("AUTH_DEV_MAILBOX нельзя включать");
  });

  it("documents VPS + DNS instead of a fake cloud deploy", () => {
    expect(deploy).toContain("SITE_DOMAIN");
    expect(deploy).toContain("A-запись");
    expect(deploy).toContain("docker compose -f docker-compose.prod.yml");
    expect(deploy).not.toMatch(/успешно задеплоено на Vercel/i);
  });
});
