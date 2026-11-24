import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  DELETE as deleteSubscription,
  GET as getSubscription,
  PATCH as patchSubscription,
  POST as postSubscription,
  PUT as putSubscription,
} from "@/app/api/subscription/route";
import {
  DELETE as deleteBillingWebhook,
  GET as getBillingWebhook,
  PATCH as patchBillingWebhook,
  POST as postBillingWebhook,
  PUT as putBillingWebhook,
} from "@/app/api/webhooks/billing/route";
import { AccessError } from "@/modules/access/permissions";
import { createAuthService } from "@/modules/auth/auth-service";
import { createBillingService } from "@/modules/billing/billing-service";
import { reserveUsage } from "@/modules/billing/usage";
import { COMMERCIAL_BILLING_DISABLED_MESSAGE, isCommercialBillingEnabled } from "@/modules/cabinet/commercial";
import { createProjectService } from "@/modules/projects/project-service";
import { prisma } from "@/server/db/prisma";
import { createBillingProviderFromEnv, getBillingStatus } from "@/server/billing";

const auth = createAuthService(prisma, "http://localhost:3000");
const projects = createProjectService(prisma);
const billing = createBillingService(prisma);

function email(label: string) {
  return `${label}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;
}

async function expectAccess(promise: Promise<unknown>, status: 400 | 403 | 404, message: RegExp) {
  const error = await promise.then(
    () => {
      throw new Error("expected AccessError");
    },
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AccessError);
  expect(error).toMatchObject({ status, message: expect.stringMatching(message) });
}

async function registerOwner(label: string) {
  const address = email(label);
  const result = await auth.register(address, "password123");
  expect(result.ok).toBe(true);
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: address },
    include: { memberships: true },
  });
  const workspaceId = user.memberships[0]?.workspaceId ?? "";
  const project = await projects.create(user.id, workspaceId, { name: `Проект ${label}` });
  return { address, userId: user.id, workspaceId, projectId: project.id };
}

describe("personal cabinet billing removal", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("does not create Plan or Subscription rows on register", async () => {
    const owner = await registerOwner("no-sub");
    expect(await prisma.subscription.findUnique({ where: { workspaceId: owner.workspaceId } })).toBeNull();
  });

  it("refuses checkout and webhooks even when commercial env vars are set", async () => {
    const previous = {
      flag: process.env.BILLING_CHECKOUT_ENABLED,
      shop: process.env.YOOKASSA_SHOP_ID,
      secret: process.env.YOOKASSA_SECRET_KEY,
      hmac: process.env.BILLING_WEBHOOK_SECRET,
    };
    process.env.BILLING_CHECKOUT_ENABLED = "true";
    process.env.YOOKASSA_SHOP_ID = "shop-should-not-enable";
    process.env.YOOKASSA_SECRET_KEY = "live-key-should-not-enable";
    process.env.BILLING_WEBHOOK_SECRET = "whsec_should-not-enable";
    try {
      expect(isCommercialBillingEnabled()).toBe(false);
      expect(getBillingStatus()).toEqual({ ready: false, provider: "disabled" });
      expect(createBillingProviderFromEnv().ready).toBe(false);
      const owner = await registerOwner("env-cannot-enable");
      const denied = await billing.startCheckout().catch((error: unknown) => error);
      expect(denied).toMatchObject({ status: 403, message: COMMERCIAL_BILLING_DISABLED_MESSAGE });
      expect(JSON.stringify(denied)).not.toMatch(/live-key-should-not-enable|shop-should-not-enable/);
      await expectAccess(billing.cancel(), 403, /не продаёт тарифы/);
      await expectAccess(billing.handleWebhook(), 403, /не продаёт тарифы/);
      await expectAccess(billing.getState(), 403, /не продаёт тарифы/);
      expect(owner.workspaceId).toBeTruthy();
    } finally {
      restoreEnv("BILLING_CHECKOUT_ENABLED", previous.flag);
      restoreEnv("YOOKASSA_SHOP_ID", previous.shop);
      restoreEnv("YOOKASSA_SECRET_KEY", previous.secret);
      restoreEnv("BILLING_WEBHOOK_SECRET", previous.hmac);
    }
  });

  it("returns 410 for leftover commercial HTTP routes on every method", async () => {
    const handlers = [
      getSubscription,
      postSubscription,
      putSubscription,
      patchSubscription,
      deleteSubscription,
      getBillingWebhook,
      postBillingWebhook,
      putBillingWebhook,
      patchBillingWebhook,
      deleteBillingWebhook,
    ];
    for (const handler of handlers) {
      const response = await handler();
      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({ ok: false, error: COMMERCIAL_BILLING_DISABLED_MESSAGE });
    }
  });

  it("does not wire YooKassa or HMAC checkout into the app", () => {
    const index = readFileSync("src/server/billing/index.ts", "utf8");
    expect(index).not.toContain("yookassa");
    expect(index).not.toContain("hmac-provider");
    expect(index).not.toContain("YOOKASSA");
    expect(index).not.toContain("BILLING_WEBHOOK_SECRET");
    expect(index).not.toContain("BILLING_CHECKOUT_ENABLED");
  });

  it("still reserves usage atomically for the cabinet AI/post counters", async () => {
    const owner = await registerOwner("usage-lock");
    const metric = `parallel_${owner.workspaceId}`;
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        reserveUsage(prisma, owner.workspaceId, metric, 3, new Date(), "Лимит исчерпан (3)."),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(5);
  });
});

function restoreEnv(name: string, previous: string | undefined) {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}
