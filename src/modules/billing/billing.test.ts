import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createAuthService } from "@/modules/auth/auth-service";
import { createBillingService } from "@/modules/billing/billing-service";
import { attachFreeSubscription, ensureCanonicalPlans } from "@/modules/billing/plans";
import { reserveUsage } from "@/modules/billing/usage";
import { createProjectService } from "@/modules/projects/project-service";
import { createWorkspaceService } from "@/modules/workspaces/workspace-service";
import { prisma } from "@/server/db/prisma";
import { createBillingSignature, createHmacBillingProvider, createUnconfiguredBillingProvider } from "@/server/billing";

const auth = createAuthService(prisma, "http://localhost:3000");
const projects = createProjectService(prisma);
const workspaces = createWorkspaceService(prisma);

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

function signedBody(secret: string, body: unknown, timestamp = Math.floor(Date.now() / 1000)) {
  const rawBody = JSON.stringify(body);
  return { rawBody, signature: createBillingSignature(secret, timestamp, rawBody) };
}

describe("billing and subscriptions", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await ensureCanonicalPlans(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("does not treat a checkout redirect as paid and rejects unconfigured checkout", async () => {
    const owner = await registerOwner("bill-none");
    const unconfigured = createBillingService(prisma, { provider: createUnconfiguredBillingProvider() });
    expect(unconfigured.status().ready).toBe(false);
    expect(JSON.stringify(unconfigured.status())).not.toMatch(/BILLING_WEBHOOK_SECRET|whsec_/);

    const free = await unconfigured.getState(owner.userId, owner.workspaceId);
    expect(free.paid).toBe(false);
    expect(free.subscription.status).toBe("free");
    expect(free.subscription.plan.slug).toBe("start");
    expect(free.subscription.paidAt).toBeNull();

    await expectAccess(
      unconfigured.startCheckout(owner.userId, owner.workspaceId, "team"),
      400,
      /требуется настройка BILLING_WEBHOOK_SECRET/,
    );
    const afterAttempt = await prisma.subscription.findUniqueOrThrow({ where: { workspaceId: owner.workspaceId } });
    expect(afterAttempt.status).toBe("free");
    expect(afterAttempt.paidAt).toBeNull();
  });

  it("activates a plan only after a verified webhook and ignores replay", async () => {
    const owner = await registerOwner("bill-ok");
    const secret = "test-billing-secret";
    const billing = createBillingService(prisma, {
      provider: createHmacBillingProvider({ secret }),
      siteUrl: "http://localhost:3000",
    });

    const started = await billing.startCheckout(owner.userId, owner.workspaceId, "team");
    expect(started.checkoutUrl).toContain("checkout=return");
    expect(started.checkoutUrl).toContain(started.checkoutId);

    const returned = await billing.getCheckout(owner.userId, owner.workspaceId, started.checkoutId);
    expect(returned.paid).toBe(false);
    expect(returned.status).toBe("pending");
    const pendingState = await billing.getState(owner.userId, owner.workspaceId);
    expect(pendingState.paid).toBe(false);
    expect(pendingState.subscription.plan.slug).toBe("start");
    expect(pendingState.subscription.status).toBe("pending_payment");

    const payload = {
      id: `evt_${owner.workspaceId}`,
      type: "payment.succeeded",
      data: {
        checkoutSessionId: started.checkoutId,
        workspaceId: owner.workspaceId,
        planSlug: "team",
        amount: 490000,
        currency: "RUB",
      },
    };
    const signed = signedBody(secret, payload);
    const first = await billing.handleWebhook(signed.rawBody, signed.signature);
    expect(first).toMatchObject({ replay: false, status: "active" });

    const paid = await billing.getState(owner.userId, owner.workspaceId);
    expect(paid.paid).toBe(true);
    expect(paid.subscription.plan.slug).toBe("team");
    expect(paid.subscription.status).toBe("active");
    expect(paid.subscription.paidAt).not.toBeNull();
    const paidAt = paid.subscription.paidAt;

    const replay = await billing.handleWebhook(signed.rawBody, signed.signature);
    expect(replay).toMatchObject({ replay: true, status: "duplicate" });
    const afterReplay = await billing.getState(owner.userId, owner.workspaceId);
    expect(afterReplay.subscription.paidAt?.toISOString()).toBe(paidAt?.toISOString());
    expect(await prisma.paymentEvent.count({ where: { providerEventId: payload.id } })).toBe(1);
    expect(paid.limits.aiGenerations).toBe(500);
  });

  it("rejects an invalid webhook signature and does not mark the workspace as paid", async () => {
    const owner = await registerOwner("bill-sig");
    const secret = "correct-secret";
    const billing = createBillingService(prisma, { provider: createHmacBillingProvider({ secret }) });
    const started = await billing.startCheckout(owner.userId, owner.workspaceId, "team");
    const signed = signedBody("wrong-secret", {
      id: `evt_bad_${owner.workspaceId}`,
      type: "payment.succeeded",
      data: { checkoutSessionId: started.checkoutId, workspaceId: owner.workspaceId },
    });
    await expectAccess(billing.handleWebhook(signed.rawBody, signed.signature), 400, /недействительна/);
    expect((await billing.getState(owner.userId, owner.workspaceId)).paid).toBe(false);
  });

  it("enforces plan resource limits and atomic usage reservation under parallel requests", async () => {
    const owner = await registerOwner("bill-limit");
    const tiny = await prisma.plan.create({
      data: {
        slug: `tiny-${owner.workspaceId}`,
        name: "Tiny",
        description: "Тестовый лимит",
        priceAmount: 0,
        isFree: true,
        aiGenerations: 1,
        projects: 1,
        socialAccounts: 1,
        members: 1,
        postsPerMonth: 1,
        featuresJson: "[]",
      },
    });
    const subscription = await attachFreeSubscription(prisma, owner.workspaceId);
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { planId: tiny.id },
    });

    await expectAccess(
      projects.create(owner.userId, owner.workspaceId, { name: "Второй проект" }),
      400,
      /Лимит проектов тарифа/,
    );

    const metric = `parallel_${owner.workspaceId}`;
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        reserveUsage(prisma, owner.workspaceId, metric, 3, new Date(), "Лимит исчерпан (3)."),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(5);
  });

  it("blocks a Viewer from starting checkout and a foreign workspace from reading billing state", async () => {
    const owner = await registerOwner("bill-acl");
    const other = await registerOwner("bill-other");
    const viewer = await registerOwner("bill-viewer");
    await workspaces.addMember(owner.userId, owner.workspaceId, viewer.address, "Viewer");
    const billing = createBillingService(prisma, {
      provider: createHmacBillingProvider({ secret: "acl-secret" }),
    });

    await expectAccess(
      billing.startCheckout(viewer.userId, owner.workspaceId, "team"),
      403,
      /Недостаточно прав/,
    );
    await expectAccess(billing.getState(other.userId, owner.workspaceId), 404, /не найдено/);
    const viewerState = await billing.getState(viewer.userId, owner.workspaceId);
    expect(viewerState.paid).toBe(false);
    expect(viewerState.plans.map((plan) => plan.slug)).toEqual(["start", "team", "business"]);
  });
});
