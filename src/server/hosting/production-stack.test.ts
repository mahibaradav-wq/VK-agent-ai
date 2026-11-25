import { existsSync, readFileSync } from "node:fs";
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
  const commonScript = read("scripts/lib/vps-common.sh");
  const pullScript = read("scripts/vps-pull.sh");
  const migrateScript = read("scripts/vps-migrate.sh");
  const restoreScript = read("scripts/restore-vps.sh");
  const ci = read(".github/workflows/ci.yml");
  const deployWorkflow = read(".github/workflows/deploy-vps.yml");
  const nav = read("src/lib/site-data.ts");
  const home = read("src/app/page.tsx");
  const pricing = read("src/app/pricing/page.tsx");
  const studio = read("src/app/app/studio/page.tsx");
  const projectsHome = read("src/app/app/page.tsx");
  const registerPage = read("src/app/register/page.tsx");

  it("builds the app image without migrating on container start", () => {
    const migrate = read("scripts/vps-migrate.sh");
    const pull = read("scripts/vps-pull.sh");
    const worker = read("src/server/queue/worker.ts");
    expect(pull).toContain("read_only_preflight");
    expect(dockerfile).toContain("npx prisma generate && npm run build");
    expect(dockerfile).toContain("ffmpeg");
    expect(dockerfile).toContain("USER polka");
    expect(dockerfile).toContain('CMD ["npm", "start", "--", "--hostname", "0.0.0.0", "--port", "3000"]');
    expect(dockerfile).not.toContain("prisma migrate deploy && npm start");
    expect(migrate).toContain("prisma migrate deploy");
    expect(migrate).toContain("BACKUP_VERIFIED");
    expect(pull).toContain("--apply");
    expect(pull).toContain("backup-vps.sh");
    expect(pull).toMatch(/HEALTHCHECK_ATTEMPTS:-40/);
    expect(upScript).toContain("_prisma_migrations");
    expect(upScript).toContain("vps-pull.sh");
    expect(worker).toContain("assertProductionCabinetGuards");
    expect(compose).toContain("stop_grace_period: 30s");
    expect(compose).toContain('user: "10001:10001"');
  });

  it("does not publish PostgreSQL and health JSON names no secrets", () => {
    const health = read("src/app/api/health/route.ts");
    expect(compose).not.toMatch(/"5432:5432"/);
    expect(health).toContain('db: "up"');
    expect(health).not.toContain("DATABASE_URL");
    expect(health).not.toContain("AUTH_SECRET");
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
    expect(caddy).toContain("www.{$SITE_DOMAIN}");
    expect(caddy).toContain("Strict-Transport-Security");
  });

  it("keeps server-action origins and upload limits fail-safe for the cabinet", () => {
    const nextConfig = read("next.config.ts");
    expect(nextConfig).not.toContain("24dom-po-polochkam.ru");
    expect(nextConfig).toContain('bodySizeLimit: "32mb"');
    expect(nextConfig).toContain("localhost:3000");
    expect(envExample).toContain("SOCIAL_PUBLISH_LIVE");
  });

  it("keeps production secrets out of git and blocks the mailbox stand", () => {
    expect(envExample).toContain("SITE_DOMAIN=");
    expect(envExample).toContain("AUTH_SECRET=");
    expect(envExample).toContain("POSTGRES_PASSWORD=");
    expect(envExample).toMatch(/# AUTH_DEV_MAILBOX=/);
    expect(envExample).toMatch(/# AI_MONTHLY_HARD_LIMIT=/);
    expect(envExample).not.toMatch(/^AUTH_DEV_MAILBOX=true$/m);
    expect(commonScript).toContain("AUTH_DEV_MAILBOX cannot be enabled");
    expect(commonScript).toContain("TOKEN_ENCRYPTION_KEY");
    expect(upScript).toContain("vps-migrate.sh");
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
    expect(ci).toContain("bash -n scripts/lib/vps-common.sh");
    expect(ci).toContain("scripts/backup-vps.sh");
    expect(ci).not.toContain("appleboy/ssh-action");
    expect(ci).not.toContain("docker compose");
    expect(ci).not.toContain("VPS_HOST");
    expect(deployWorkflow).toContain("workflow_dispatch:");
    expect(deployWorkflow).toContain("Deploy VPS is disabled");
    expect(deployWorkflow).not.toContain("appleboy/ssh-action");
    expect(deployWorkflow).not.toContain("I-UNDERSTAND-THIS-SSHS-TO-PRODUCTION");
    expect(deployWorkflow).not.toContain("pull_request:");
    expect(deployWorkflow).not.toContain("npm test");
    expect(deployWorkflow).not.toContain("docker compose");
    expect(deployWorkflow).not.toContain("up -d --build");
    expect(commonScript).toContain("vps_probe_assert_isolated_target");
    expect(commonScript).toContain("vps_probe_exec");
    expect(commonScript).toContain("vps_probe_migrate_deploy");
    expect(commonScript).toContain("vps_probe_refuse_inherited_libpq");
    expect(commonScript).toContain("vps_harness_admin_exec");
    expect(commonScript).toContain("vps_harness_prepare_probe_database");
    expect(commonScript).toContain("PROBE_HARNESS_ADMIN_URL");
    expect(commonScript).toContain("env -i");
    const harness = read("scripts/tests/vps-ops.test.sh");
    expect(harness).toContain("vps_harness_prepare_probe_database");
    expect(harness).not.toContain('Path(".env")');
    expect(harness).not.toContain('subprocess.run(["psql"');
    expect(commonScript).not.toContain("24dom-po-polochkam");
    expect(commonScript).not.toContain("timeweb");
    expect(migrateScript).toContain("vps_probe_migrate_deploy");
    expect(migrateScript).not.toMatch(/DATABASE_URL="\$PROBE_DATABASE_URL" npx prisma migrate deploy/);
    expect(pullScript).toContain("read_only_preflight");
    expect(pullScript).toContain("--plan is read-only");
  });

  it("requires explicit restore confirmation and checksum verification", () => {
    expect(restoreScript).toContain('CONFIRM_RESTORE:-}');
    expect(restoreScript).toContain("sha256sum --check");
    expect(restoreScript).toContain("Type RESTORE to continue");
    expect(restoreScript).toContain("vps_same_backup_set");
    expect(commonScript).toContain(".restore-staging");
  });

  it("hides commercial pricing and checkout from the personal-cabinet UI", () => {
    const billingIndex = read("src/server/billing/index.ts");
    const adminNav = read("src/app/admin/layout.tsx");
    expect(nav).not.toContain('href: "/pricing"');
    expect(home).not.toContain("PricingTable");
    expect(pricing).not.toContain("PricingTable");
    expect(pricing).toContain("Коммерческие тарифы не продаются");
    expect(projectsHome).toContain("restoreProject");
    expect(projectsHome).toContain("archiveProject");
    expect(registerPage).toContain("isPublicRegistrationOpen");
    expect(adminNav).not.toContain("/admin/plans");
    expect(billingIndex).not.toContain("yookassa");
    expect(billingIndex).not.toContain("BILLING_CHECKOUT_ENABLED");
    expect(envExample).not.toContain("YOOKASSA_SHOP_ID=");
    expect(envExample).not.toContain("BILLING_CHECKOUT_ENABLED");
    expect(existsSync("src/modules/billing/plans.ts")).toBe(false);
    expect(existsSync("src/components/marketing/pricing-table.tsx")).toBe(false);
    expect(existsSync("src/components/app/subscription-board.tsx")).toBe(false);
    expect(existsSync("src/server/billing/yookassa.ts")).toBe(false);
    expect(existsSync("src/server/billing/hmac-provider.ts")).toBe(false);
  });

  it("does not start image generation when Studio loads", () => {
    expect(studio).not.toContain("generateImage");
    expect(studio).not.toContain("composeAgentPost");
  });
});
