import type { Plan, Prisma, PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";

export type DbClient = PrismaClient | Prisma.TransactionClient;

export type PlanDefinition = {
  slug: string;
  name: string;
  description: string;
  priceAmount: number;
  currency: "RUB";
  interval: "month";
  highlighted: boolean;
  isFree: boolean;
  checkout: "free" | "self" | "contract";
  aiGenerations: number;
  projects: number;
  socialAccounts: number;
  members: number;
  postsPerMonth: number;
  features: string[];
};

export type PlanLimits = {
  aiGenerations: number;
  projects: number;
  socialAccounts: number;
  members: number;
  postsPerMonth: number;
  slug: string;
  name: string;
  isFree: boolean;
};

export const PLAN_CATALOG: PlanDefinition[] = [
  {
    slug: "start",
    name: "Start",
    description: "Для знакомства с платформой и планирования первых публикаций.",
    priceAmount: 0,
    currency: "RUB",
    interval: "month",
    highlighted: false,
    isFree: true,
    checkout: "free",
    aiGenerations: 50,
    projects: 50,
    socialAccounts: 20,
    members: 50,
    postsPerMonth: 500,
    features: ["календарь", "черновики", "согласование", "базовые лимиты"],
  },
  {
    slug: "team",
    name: "Team",
    description: "Для команды, approval workflow и нескольких проектов.",
    priceAmount: 490000,
    currency: "RUB",
    interval: "month",
    highlighted: true,
    isFree: false,
    checkout: "self",
    aiGenerations: 500,
    projects: 20,
    socialAccounts: 20,
    members: 30,
    postsPerMonth: 2000,
    features: ["роли команды", "approval", "медиатека", "аналитика", "500 AI-генераций"],
  },
  {
    slug: "business",
    name: "Business",
    description: "Для брендов с интеграциями, очередями и расширенными лимитами.",
    priceAmount: 0,
    currency: "RUB",
    interval: "month",
    highlighted: false,
    isFree: false,
    checkout: "contract",
    aiGenerations: 5000,
    projects: 100,
    socialAccounts: 50,
    members: 100,
    postsPerMonth: 20000,
    features: ["реальные API", "очереди", "S3", "аудит", "оформление по договору"],
  },
];

export function monthBounds(at: Date) {
  const start = DateTime.fromJSDate(at, { zone: "utc" }).startOf("month");
  return {
    periodStart: start.toJSDate(),
    periodEnd: start.endOf("month").toJSDate(),
  };
}

export function formatPlanPrice(plan: Pick<PlanDefinition, "priceAmount" | "currency" | "checkout" | "isFree">) {
  if (plan.checkout === "contract") {
    return "по договору";
  }
  if (plan.isFree || plan.priceAmount === 0) {
    return "0 ₽";
  }
  const major = plan.priceAmount / 100;
  return `${new Intl.NumberFormat("ru-RU").format(major)} ₽ / мес`;
}

export function marketingPlans() {
  return PLAN_CATALOG.map((plan) => ({
    name: plan.name,
    price: formatPlanPrice(plan),
    description: plan.description,
    features: plan.features,
    highlighted: plan.highlighted,
  }));
}

export function toPlanLimits(plan: Plan): PlanLimits {
  return {
    aiGenerations: plan.aiGenerations,
    projects: plan.projects,
    socialAccounts: plan.socialAccounts,
    members: plan.members,
    postsPerMonth: plan.postsPerMonth,
    slug: plan.slug,
    name: plan.name,
    isFree: plan.isFree,
  };
}

export async function ensureCanonicalPlans(db: DbClient) {
  for (const plan of PLAN_CATALOG) {
    await db.plan.upsert({
      where: { slug: plan.slug },
      create: {
        slug: plan.slug,
        name: plan.name,
        description: plan.description,
        priceAmount: plan.priceAmount,
        currency: plan.currency,
        interval: plan.interval,
        highlighted: plan.highlighted,
        isFree: plan.isFree,
        aiGenerations: plan.aiGenerations,
        projects: plan.projects,
        socialAccounts: plan.socialAccounts,
        members: plan.members,
        postsPerMonth: plan.postsPerMonth,
        featuresJson: JSON.stringify(plan.features),
      },
      update: {
        name: plan.name,
        description: plan.description,
        priceAmount: plan.priceAmount,
        currency: plan.currency,
        interval: plan.interval,
        highlighted: plan.highlighted,
        isFree: plan.isFree,
        aiGenerations: plan.aiGenerations,
        projects: plan.projects,
        socialAccounts: plan.socialAccounts,
        members: plan.members,
        postsPerMonth: plan.postsPerMonth,
        featuresJson: JSON.stringify(plan.features),
      },
    });
  }
}

export async function attachFreeSubscription(db: DbClient, workspaceId: string, at = new Date()) {
  const existing = await db.subscription.findUnique({
    where: { workspaceId },
    include: { plan: true },
  });
  if (existing) {
    return existing;
  }
  await ensureCanonicalPlans(db);
  const start = await db.plan.findUniqueOrThrow({ where: { slug: "start" } });
  const { periodStart, periodEnd } = monthBounds(at);
  return db.subscription.create({
    data: {
      workspaceId,
      planId: start.id,
      status: "free",
      provider: "none",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    },
    include: { plan: true },
  });
}

export async function getWorkspacePlanLimits(db: DbClient, workspaceId: string, at = new Date()): Promise<PlanLimits> {
  const subscription = await attachFreeSubscription(db, workspaceId, at);
  const plan = "plan" in subscription && subscription.plan ? subscription.plan : await db.plan.findUniqueOrThrow({ where: { id: subscription.planId } });
  return toPlanLimits(plan);
}
