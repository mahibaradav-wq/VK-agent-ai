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
  const restoreScript = read("scripts/restore-vps.sh");
  const ci = read(".github/workflows/ci.yml");
  const deployWorkflow = read(".github/workflows/deploy-vps.yml");
  const nav = read("src/lib/site-data.ts");
  const home = read("src/app/page.tsx");
  const pricing = read("src/app/pricing/page.tsx");
  const studio = read("src/app/app/studio/page.tsx");
  const projectsHome = read("src/app/app/page.tsx");
  const registerPage = read("src/app/register/page.tsx");

  it("builds the app image and applies migrations before start", () => {
    expect(dockerfile).toContain("npx prisma generate && npm run build");
    expect(dockerfile).toContain("npx prisma migrate deploy");
    expect(dockerfile).toContain("ffmpeg");
    expect(dockerfile).toContain("npm start -- --hostname 0.0.0.0 --port 3000");
  });

  it("gives the app IPv6 so outbound APIs can use dual-stack", () => {
    expect(compose).toContain("enable_ipv6: true");
    expect(compose).toContain("fd12:706f:6c6b:1::/64");
    expect(compose).toContain("172.18.0.1");
  });

  it("exposes HTTPS via Caddy on a real domain", () => {
    expect(compose).toContain("caddy:2-alpine");
    expect(compose).toContain('"80:80"');
    expect(compose).toContain('"443:443"');
    expect(compose).toContain("SITE_DOMAIN");
    expect(caddy).toContain("reverse_proxy app:3000");
    expect(caddy).toContain("header_up X-Real-IP {remote_host}");
    expect(caddy).toContain("{$SITE_DOMAIN}");
    expect(caddy).toContain("Strict-Transport-Security");
  });

  it("keeps production secrets out of git and blocks the mailbox stand", () => {
    expect(envExample).toContain("SITE_DOMAIN=");
    expect(envExample).toContain("AUTH_SECRET=");
    expect(envExample).toContain("POSTGRES_PASSWORD=");
    expect(envExample).toMatch(/# AUTH_DEV_MAILBOX=/);
    expect(envExample).toMatch(/# AI_MONTHLY_HARD_LIMIT=/);
    expect(envExample).not.toMatch(/^AUTH_DEV_MAILBOX=true$/m);
    expect(upScript).toContain("AUTH_DEV_MAILBOX нельзя включать");
    expect(deploy).toContain("Первый аккаунт на рабочем сайте подтверждается сразу");
  });

  it("documents VPS + DNS instead of a fake cloud deploy", () => {
    expect(deploy).toContain("SITE_DOMAIN");
    expect(deploy).toContain("A-запись");
    expect(deploy).toContain("bash scripts/vps-up.sh");
    expect(deploy).not.toMatch(/успешно задеплоено на Vercel/i);
  });

  it("runs test, typecheck and lint on a pull request without deploying", () => {
    expect(ci).toContain("pull_request:");
    expect(ci).toContain("npm run typecheck");
    expect(ci).toContain("npm run lint");
    expect(ci).toContain("npm test");
    expect(ci).toContain("bash -n scripts/backup-vps.sh");
    expect(ci).not.toContain("appleboy/ssh-action");
    expect(ci).not.toContain("docker compose");
    expect(ci).not.toContain("VPS_HOST");
    expect(deployWorkflow).toContain("workflow_dispatch:");
    expect(deployWorkflow).not.toContain("pull_request:");
    expect(deployWorkflow).not.toContain("npm test");
  });

  it("requires explicit restore confirmation and checksum verification", () => {
    expect(restoreScript).toContain('CONFIRM_RESTORE:-}');
    expect(restoreScript).toContain("sha256sum --check");
    expect(restoreScript).toContain('Type RESTORE to continue');
  });

  it("hides commercial pricing and checkout from the personal-cabinet UI", () => {
    expect(nav).not.toContain('href: "/pricing"');
    expect(home).not.toContain("PricingTable");
    expect(pricing).not.toContain("PricingTable");
    expect(pricing).toContain("Коммерческие тарифы не продаются");
    expect(projectsHome).toContain("restoreProject");
    expect(projectsHome).toContain("archiveProject");
    expect(registerPage).toContain("isPublicRegistrationOpen");
  });

  it("does not start image generation when Studio loads", () => {
    expect(studio).not.toContain("generateImage");
    expect(studio).not.toContain("composeAgentPost");
  });
});
