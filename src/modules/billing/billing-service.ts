import type { Prisma, PrismaClient } from "@prisma/client";

import { AccessError } from "@/modules/access/permissions";
import { createAccessService } from "@/modules/access/access-service";
import {
  attachFreeSubscription,
  ensureCanonicalPlans,
  formatPlanPrice,
  monthBounds,
  PLAN_CATALOG,
  toPlanLimits,
} from "@/modules/billing/plans";
import { getUsage, USAGE_METRICS } from "@/modules/billing/usage";
import { deliverNotifications } from "@/modules/notifications/dispatch";
import { getBillingProvider, type BillingProvider } from "@/server/billing";

const subscriptionInclude = { plan: true } satisfies Prisma.SubscriptionInclude;

function featuresOf(featuresJson: string) {
  try {
    const parsed = JSON.parse(featuresJson) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    return [];
  }
  return [];
}

export function createBillingService(
  db: PrismaClient,
  options?: {
    provider?: BillingProvider;
    now?: () => Date;
    siteUrl?: string;
  },
) {
  const access = createAccessService(db);
  const provider = options?.provider ?? getBillingProvider();
  const now = options?.now ?? (() => new Date());
  const siteUrl = options?.siteUrl ?? process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  async function loadSubscription(workspaceId: string) {
    await ensureCanonicalPlans(db);
    const current = await attachFreeSubscription(db, workspaceId, now());
    return db.subscription.findUniqueOrThrow({
      where: { id: current.id },
      include: subscriptionInclude,
    });
  }

  async function syncExpired(workspaceId: string) {
    const subscription = await loadSubscription(workspaceId);
    const at = now();
    if (subscription.status === "active" && subscription.currentPeriodEnd < at) {
      const start = await db.plan.findUniqueOrThrow({ where: { slug: "start" } });
      const period = monthBounds(at);
      return db.subscription.update({
        where: { id: subscription.id },
        data: {
          status: subscription.cancelAtPeriodEnd ? "canceled" : "past_due",
          planId: start.id,
          paidAt: null,
          provider: subscription.cancelAtPeriodEnd ? "none" : subscription.provider,
          currentPeriodStart: period.periodStart,
          currentPeriodEnd: period.periodEnd,
          cancelAtPeriodEnd: false,
        },
        include: subscriptionInclude,
      });
    }
    if (subscription.status === "pending_payment" && subscription.plan.isFree === false && !subscription.paidAt) {
      return subscription;
    }
    return subscription;
  }

  function isPaid(subscription: { status: string; paidAt: Date | null; currentPeriodEnd: Date }) {
    return subscription.status === "active" && subscription.paidAt != null && subscription.currentPeriodEnd >= now();
  }

  async function notifyOwners(workspaceId: string, title: string, body: string, entityId: string) {
    const members = await db.workspaceMember.findMany({
      where: { workspaceId, role: { in: ["Owner", "Admin"] } },
    });
    if (members.length === 0) {
      return;
    }
    await deliverNotifications(db, {
      workspaceId,
      userIds: members.map((member) => member.userId),
      type: "billing",
      title,
      body,
      entityType: "subscription",
      entityId,
      url: "/app/subscription",
    });
  }

  return {
    status() {
      return {
        ready: provider.ready,
        provider: provider.name,
      };
    },

    async listPlans() {
      await ensureCanonicalPlans(db);
      const catalogSlugs = PLAN_CATALOG.map((plan) => plan.slug);
      const rows = await db.plan.findMany({
        where: { slug: { in: catalogSlugs } },
      });
      rows.sort((left, right) => catalogSlugs.indexOf(left.slug) - catalogSlugs.indexOf(right.slug));
      return rows.map((plan) => ({
        ...toPlanLimits(plan),
        id: plan.id,
        description: plan.description,
        priceAmount: plan.priceAmount,
        currency: plan.currency,
        interval: plan.interval,
        highlighted: plan.highlighted,
        priceLabel: formatPlanPrice({
          priceAmount: plan.priceAmount,
          currency: "RUB",
          checkout: PLAN_CATALOG.find((item) => item.slug === plan.slug)?.checkout ?? "self",
          isFree: plan.isFree,
        }),
        features: featuresOf(plan.featuresJson),
        checkout: PLAN_CATALOG.find((item) => item.slug === plan.slug)?.checkout ?? "self",
      }));
    },

    async getState(userId: string, workspaceId: string) {
      await access.requirePermission(userId, workspaceId, "billing.view");
      const subscription = await syncExpired(workspaceId);
      const limits = toPlanLimits(subscription.plan);
      const at = now();
      const [ai, posts, projects, members, socialAccounts] = await Promise.all([
        getUsage(db, workspaceId, USAGE_METRICS.ai, at, limits.aiGenerations),
        getUsage(db, workspaceId, USAGE_METRICS.posts, at, limits.postsPerMonth),
        db.project.count({ where: { workspaceId, archivedAt: null } }),
        db.workspaceMember.count({ where: { workspaceId } }),
        db.socialAccount.count({ where: { workspaceId, status: { not: "disconnected" } } }),
      ]);
      return {
        ready: provider.ready,
        provider: provider.name,
        paid: isPaid(subscription),
        subscription: {
          id: subscription.id,
          status: subscription.status,
          provider: subscription.provider,
          paidAt: subscription.paidAt,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          plan: {
            slug: subscription.plan.slug,
            name: subscription.plan.name,
            isFree: subscription.plan.isFree,
            priceLabel: formatPlanPrice({
              priceAmount: subscription.plan.priceAmount,
              currency: "RUB",
              checkout: PLAN_CATALOG.find((item) => item.slug === subscription.plan.slug)?.checkout ?? "self",
              isFree: subscription.plan.isFree,
            }),
          },
        },
        limits,
        usage: {
          ai: { used: ai.used, limit: limits.aiGenerations },
          posts: { used: posts.used, limit: limits.postsPerMonth },
          projects: { used: projects, limit: limits.projects },
          members: { used: members, limit: limits.members },
          socialAccounts: { used: socialAccounts, limit: limits.socialAccounts },
        },
        plans: await this.listPlans(),
      };
    },

    async getCheckout(userId: string, workspaceId: string, checkoutId: string) {
      await access.requirePermission(userId, workspaceId, "billing.view");
      const checkout = await db.checkoutSession.findUnique({
        where: { id: checkoutId },
        include: { plan: true, subscription: true },
      });
      if (!checkout || checkout.workspaceId !== workspaceId) {
        throw new AccessError(404, "Сессия оплаты не найдена.");
      }
      return {
        id: checkout.id,
        status: checkout.status,
        planSlug: checkout.plan.slug,
        planName: checkout.plan.name,
        paid: isPaid(checkout.subscription),
        subscriptionStatus: checkout.subscription.status,
      };
    },

    async startCheckout(userId: string, workspaceId: string, planSlug: string) {
      await access.requirePermission(userId, workspaceId, "billing.manage");
      if (!provider.ready) {
        throw new AccessError(
          400,
          "Оплата недоступна: требуется настройка BILLING_WEBHOOK_SECRET. Редирект не считается оплатой.",
        );
      }
      const definition = PLAN_CATALOG.find((plan) => plan.slug === planSlug);
      if (!definition) {
        throw new AccessError(404, "Тариф не найден.");
      }
      if (definition.checkout === "free") {
        throw new AccessError(400, "Бесплатный тариф не оплачивается.");
      }
      if (definition.checkout === "contract") {
        throw new AccessError(400, "Тариф Business оформляется по договору, не через автоматический checkout.");
      }
      const subscription = await loadSubscription(workspaceId);
      if (subscription.plan.slug === planSlug && isPaid(subscription)) {
        throw new AccessError(400, "Этот тариф уже активен.");
      }
      const plan = await db.plan.findUniqueOrThrow({ where: { slug: planSlug } });
      const checkout = await db.checkoutSession.create({
        data: {
          workspaceId,
          subscriptionId: subscription.id,
          planId: plan.id,
          status: "pending",
          provider: provider.name,
        },
      });
      const created = await provider.createCheckout({
        checkoutId: checkout.id,
        workspaceId,
        planSlug,
        successUrl: `${siteUrl}/app/subscription`,
        cancelUrl: `${siteUrl}/app/subscription?checkout=cancel`,
      });
      await db.$transaction([
        db.checkoutSession.update({
          where: { id: checkout.id },
          data: { providerRef: created.sessionId },
        }),
        db.subscription.update({
          where: { id: subscription.id },
          data: { status: "pending_payment" },
        }),
        db.auditLog.create({
          data: {
            action: "START_CHECKOUT",
            entityType: "checkout_session",
            entityId: checkout.id,
            actorId: userId,
            details: `${planSlug}:${provider.name}`,
          },
        }),
      ]);
      return { checkoutUrl: created.checkoutUrl, checkoutId: checkout.id };
    },

    async cancel(userId: string, workspaceId: string) {
      await access.requirePermission(userId, workspaceId, "billing.manage");
      const subscription = await loadSubscription(workspaceId);
      if (!isPaid(subscription)) {
        throw new AccessError(400, "Нет оплаченной подписки для отмены.");
      }
      const updated = await db.subscription.update({
        where: { id: subscription.id },
        data: { cancelAtPeriodEnd: true },
        include: subscriptionInclude,
      });
      await db.auditLog.create({
        data: {
          action: "CANCEL_SUBSCRIPTION",
          entityType: "subscription",
          entityId: updated.id,
          actorId: userId,
          details: updated.plan.slug,
        },
      });
      return updated;
    },

    async handleWebhook(rawBody: string, signatureHeader: string) {
      const event = await provider.verifyWebhook(rawBody, signatureHeader);
      if (event.type === "payment.succeeded") {
        if (!event.checkoutSessionId) {
          throw new AccessError(400, "В webhook нет checkoutSessionId.");
        }
        const checkout = await db.checkoutSession.findUnique({ where: { id: event.checkoutSessionId } });
        if (!checkout) {
          throw new AccessError(400, "Сессия оплаты не найдена.");
        }
        if (event.workspaceId && event.workspaceId !== checkout.workspaceId) {
          throw new AccessError(400, "workspaceId webhook не совпадает с сессией оплаты.");
        }
      }

      await db.paymentEvent.upsert({
        where: {
          provider_providerEventId: { provider: event.provider, providerEventId: event.eventId },
        },
        create: {
          provider: event.provider,
          providerEventId: event.eventId,
          type: event.type,
          workspaceId: event.workspaceId ?? null,
          checkoutId: event.checkoutSessionId ?? null,
          rawPayload: event.raw as Prisma.InputJsonValue,
          processed: false,
        },
        update: {},
      });

      const applied = await db.$transaction(async (tx) => {
        const claimed = await tx.$executeRaw`
          UPDATE "PaymentEvent"
          SET "processed" = true, "processedAt" = NOW()
          WHERE "provider" = ${event.provider}
            AND "providerEventId" = ${event.eventId}
            AND "processed" = false
        `;
        if (claimed !== 1) {
          return { replay: true as const, status: "duplicate" as const };
        }

        if (event.type === "payment.succeeded" && event.checkoutSessionId) {
          const checkout = await tx.checkoutSession.findUniqueOrThrow({
            where: { id: event.checkoutSessionId },
            include: { plan: true, subscription: true },
          });
          const period = monthBounds(now());
          const subscription = await tx.subscription.update({
            where: { id: checkout.subscriptionId },
            data: {
              planId: checkout.planId,
              status: "active",
              provider: event.provider,
              providerCustomerId: event.providerCustomerId ?? checkout.subscription.providerCustomerId,
              providerSubscriptionId: event.providerSubscriptionId ?? checkout.subscription.providerSubscriptionId,
              currentPeriodStart: period.periodStart,
              currentPeriodEnd: period.periodEnd,
              cancelAtPeriodEnd: false,
              paidAt: checkout.subscription.paidAt ?? now(),
            },
          });
          await tx.checkoutSession.update({
            where: { id: checkout.id },
            data: { status: "completed", completedAt: checkout.completedAt ?? now() },
          });
          await tx.paymentEvent.update({
            where: {
              provider_providerEventId: { provider: event.provider, providerEventId: event.eventId },
            },
            data: {
              workspaceId: checkout.workspaceId,
              subscriptionId: subscription.id,
              checkoutId: checkout.id,
            },
          });
          await tx.auditLog.create({
            data: {
              action: "PAYMENT_SUCCEEDED",
              entityType: "subscription",
              entityId: subscription.id,
              details: `${checkout.plan.slug}:${event.eventId}`,
            },
          });
          return {
            replay: false as const,
            status: "active" as const,
            workspaceId: checkout.workspaceId,
            subscriptionId: subscription.id,
            planName: checkout.plan.name,
          };
        }

        if (event.type === "payment.failed" && event.checkoutSessionId) {
          const checkout = await tx.checkoutSession.findUnique({ where: { id: event.checkoutSessionId } });
          if (checkout && checkout.status === "pending") {
            await tx.checkoutSession.update({
              where: { id: checkout.id },
              data: { status: "canceled" },
            });
            const subscription = await tx.subscription.findUniqueOrThrow({
              where: { id: checkout.subscriptionId },
              include: { plan: true },
            });
            if (subscription.status === "pending_payment" && !subscription.paidAt) {
              await tx.subscription.update({
                where: { id: subscription.id },
                data: { status: "free" },
              });
            }
          }
          return { replay: false as const, status: "failed" as const };
        }

        if (event.type === "subscription.canceled" && event.workspaceId) {
          const subscription = await tx.subscription.findUnique({
            where: { workspaceId: event.workspaceId },
          });
          if (subscription?.paidAt) {
            await tx.subscription.update({
              where: { id: subscription.id },
              data: { cancelAtPeriodEnd: true },
            });
          }
          return { replay: false as const, status: "canceled" as const };
        }

        return { replay: false as const, status: "ignored" as const };
      });

      if (!applied.replay && applied.status === "active") {
        await notifyOwners(
          applied.workspaceId,
          "Оплата подтверждена",
          `Тариф ${applied.planName} активирован после проверки подписанного webhook.`,
          applied.subscriptionId,
        );
      }

      return applied;
    },
  };
}
