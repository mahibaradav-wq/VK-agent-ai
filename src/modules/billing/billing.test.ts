import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createAuthService } from "@/modules/auth/auth-service";
import { createBillingService } from "@/modules/billing/billing-service";
import { attachFreeSubscription, ensureCanonicalPlans, getWorkspacePlanLimits } from "@/modules/billing/plans";
import { getUsage, reserveUsage, USAGE_METRICS } from "@/modules/billing/usage";
import { createProjectService } from "@/modules/projects/project-service";
import { createWorkspaceService } from "@/modules/workspaces/workspace-service";
import { prisma } from "@/server/db/prisma";
import {
  createBillingSignature,
  createHmacBillingProvider,
  createUnconfiguredBillingProvider,
  createYookassaBillingProvider,
} from "@/server/billing";

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
      /YOOKASSA_SHOP_ID/,
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
    expect(paid.usage.ai).toMatchObject({ used: 0, limit: 0 });
    expect("aiGenerations" in paid.limits).toBe(false);
    expect(paid.plans.find((plan) => plan.slug === "team")?.features.join(" ")).not.toMatch(/AI-генераций/);
  });

  it("rejects mismatched provider, workspace, plan, amount, or currency before activating a checkout", async () => {
    const owner = await registerOwner("bill-mismatch");
    const secret = "mismatch-billing-secret";
    const hmacProvider = createHmacBillingProvider({ secret });
    const provider = {
      ...hmacProvider,
      async verifyWebhook(rawBody: string, signatureHeader: string) {
        const verified = await hmacProvider.verifyWebhook(rawBody, signatureHeader);
        return { ...verified, provider: verified.eventId === "wrong-provider" ? "other" : verified.provider };
      },
    };
    const billing = createBillingService(prisma, { provider });
    const started = await billing.startCheckout(owner.userId, owner.workspaceId, "team");
    const invalidEvents = [
      { id: "wrong-provider", workspaceId: owner.workspaceId, planSlug: "team", amount: 490000, currency: "RUB" },
      { id: "wrong-workspace", workspaceId: "foreign-workspace", planSlug: "team", amount: 490000, currency: "RUB" },
      { id: "wrong-plan", workspaceId: owner.workspaceId, planSlug: "business", amount: 490000, currency: "RUB" },
      { id: "wrong-amount", workspaceId: owner.workspaceId, planSlug: "team", amount: 100, currency: "RUB" },
      { id: "wrong-currency", workspaceId: owner.workspaceId, planSlug: "team", amount: 490000, currency: "USD" },
    ];

    for (const invalid of invalidEvents) {
      const signed = signedBody(secret, {
        id: invalid.id,
        type: "payment.succeeded",
        data: {
          checkoutSessionId: started.checkoutId,
          workspaceId: invalid.workspaceId,
          planSlug: invalid.planSlug,
          amount: invalid.amount,
          currency: invalid.currency,
        },
      });
      await expectAccess(billing.handleWebhook(signed.rawBody, signed.signature), 400, /провайдер|workspaceId|Тариф|Сумма|Валюта/);
    }

    const state = await billing.getState(owner.userId, owner.workspaceId);
    expect(state.paid).toBe(false);
    expect(state.subscription.status).toBe("pending_payment");
    expect(await prisma.paymentEvent.count({ where: { checkoutId: started.checkoutId } })).toBe(0);
  });

  it("does not activate a completed checkout from a second distinct payment event", async () => {
    const owner = await registerOwner("bill-double");
    const secret = "double-billing-secret";
    const billing = createBillingService(prisma, { provider: createHmacBillingProvider({ secret }) });
    const started = await billing.startCheckout(owner.userId, owner.workspaceId, "team");
    const makeEvent = (id: string) => signedBody(secret, {
      id,
      type: "payment.succeeded",
      data: {
        checkoutSessionId: started.checkoutId,
        workspaceId: owner.workspaceId,
        planSlug: "team",
        amount: 490000,
        currency: "RUB",
      },
    });
    const first = makeEvent("first-payment-event");
    await billing.handleWebhook(first.rawBody, first.signature);
    const second = makeEvent("second-payment-event");
    await expectAccess(billing.handleWebhook(second.rawBody, second.signature), 400, /уже обработана|не ожидает/);
    expect((await billing.getState(owner.userId, owner.workspaceId)).subscription.plan.slug).toBe("team");
    expect(await prisma.paymentEvent.count({ where: { checkoutId: started.checkoutId, processed: true } })).toBe(1);
  });

  it("activates Team only after ЮKassa API confirms the payment", async () => {
    const owner = await registerOwner("bill-yk");
    let checkoutId = "";
    let paymentStatus = "pending";
    const paymentId = `pay_yk_${owner.workspaceId}`;
    const billing = createBillingService(prisma, {
      provider: createYookassaBillingProvider({
        shopId: "shop-test",
        secretKey: "secret-test",
        fetchImpl: async (url, init) => {
          if (String(url).endsWith("/payments") && init?.method === "POST") {
            const body = JSON.parse(String(init.body)) as { metadata: { checkoutId: string } };
            checkoutId = body.metadata.checkoutId;
            return new Response(
              JSON.stringify({
                id: paymentId,
                status: "pending",
                confirmation: { confirmation_url: `https://yoomoney.ru/checkout/${paymentId}` },
              }),
              { status: 200 },
            );
          }
          return new Response(
            JSON.stringify({
              id: paymentId,
              status: paymentStatus,
              amount: { value: "4900.00", currency: "RUB" },
              metadata: { checkoutId, workspaceId: owner.workspaceId, planSlug: "team" },
            }),
            { status: 200 },
          );
        },
      }),
      siteUrl: "http://localhost:3000",
    });

    const started = await billing.startCheckout(owner.userId, owner.workspaceId, "team");
    expect(started.checkoutUrl).toBe(`https://yoomoney.ru/checkout/${paymentId}`);
    expect(checkoutId).toBe(started.checkoutId);

    const notice = JSON.stringify({
      type: "notification",
      event: "payment.succeeded",
      object: { id: paymentId },
    });
    paymentStatus = "pending";
    await expectAccess(billing.handleWebhook(notice, ""), 400, /не подтвердила платёж/);
    expect((await billing.getState(owner.userId, owner.workspaceId)).paid).toBe(false);

    paymentStatus = "succeeded";
    const first = await billing.handleWebhook(notice, "");
    expect(first).toMatchObject({ replay: false, status: "active" });
    expect((await billing.getState(owner.userId, owner.workspaceId)).paid).toBe(true);
    expect((await billing.getState(owner.userId, owner.workspaceId)).subscription.plan.slug).toBe("team");
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
        aiGenerations: 0,
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

  it("falls back to the Start plan after a paid subscription expires", async () => {
    const owner = await registerOwner("bill-expired-plan");
    const subscription = await attachFreeSubscription(prisma, owner.workspaceId);
    const team = await prisma.plan.findUniqueOrThrow({ where: { slug: "team" } });
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        planId: team.id,
        status: "active",
        paidAt: new Date("2026-01-01T00:00:00.000Z"),
        currentPeriodStart: new Date("2026-01-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-02-01T00:00:00.000Z"),
      },
    });

    const expired = await getWorkspacePlanLimits(prisma, owner.workspaceId, new Date("2026-03-01T00:00:00.000Z"));
    expect(expired.slug).toBe("start");

    const active = await getWorkspacePlanLimits(prisma, owner.workspaceId, new Date("2026-01-15T00:00:00.000Z"));
    expect(active.slug).toBe("team");
  });

  it("does not cap AI usage when the monthly limit is unlimited", async () => {
    const owner = await registerOwner("bill-unlim");
    for (let index = 0; index < 6; index += 1) {
      await reserveUsage(prisma, owner.workspaceId, USAGE_METRICS.ai, 0, new Date(), "лимит не должен сработать");
    }
    const usage = await getUsage(prisma, owner.workspaceId, USAGE_METRICS.ai, new Date(), 0);
    expect(usage.used).toBe(6);
    expect(usage.limit).toBe(0);
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
