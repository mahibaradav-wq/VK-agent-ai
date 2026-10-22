-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('free', 'pending_payment', 'active', 'past_due', 'canceled');

-- CreateEnum
CREATE TYPE "CheckoutSessionStatus" AS ENUM ('pending', 'completed', 'expired', 'canceled');

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priceAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "interval" TEXT NOT NULL DEFAULT 'month',
    "highlighted" BOOLEAN NOT NULL DEFAULT false,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "aiGenerations" INTEGER NOT NULL,
    "projects" INTEGER NOT NULL,
    "socialAccounts" INTEGER NOT NULL,
    "members" INTEGER NOT NULL,
    "postsPerMonth" INTEGER NOT NULL,
    "featuresJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'free',
    "provider" TEXT NOT NULL,
    "providerCustomerId" TEXT,
    "providerSubscriptionId" TEXT,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "CheckoutSessionStatus" NOT NULL DEFAULT 'pending',
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CheckoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "workspaceId" TEXT,
    "subscriptionId" TEXT,
    "checkoutId" TEXT,
    "rawPayload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_slug_key" ON "Plan"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_workspaceId_key" ON "Subscription"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutSession_providerRef_key" ON "CheckoutSession"("providerRef");

-- CreateIndex
CREATE INDEX "CheckoutSession_workspaceId_status_idx" ON "CheckoutSession"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_provider_providerEventId_key" ON "PaymentEvent"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "PaymentEvent_workspaceId_createdAt_idx" ON "PaymentEvent"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "Plan" (
    "id",
    "slug",
    "name",
    "description",
    "priceAmount",
    "currency",
    "interval",
    "highlighted",
    "isFree",
    "aiGenerations",
    "projects",
    "socialAccounts",
    "members",
    "postsPerMonth",
    "featuresJson",
    "createdAt",
    "updatedAt"
) VALUES
(
    'plan_start',
    'start',
    'Start',
    'Для знакомства с платформой и планирования первых публикаций.',
    0,
    'RUB',
    'month',
    false,
    true,
    50,
    50,
    20,
    50,
    500,
    '["календарь","черновики","согласование","базовые лимиты"]',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
),
(
    'plan_team',
    'team',
    'Team',
    'Для команды, approval workflow и нескольких проектов.',
    490000,
    'RUB',
    'month',
    true,
    false,
    500,
    20,
    20,
    30,
    2000,
    '["роли команды","approval","медиатека","аналитика","500 AI-генераций"]',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
),
(
    'plan_business',
    'business',
    'Business',
    'Для брендов с интеграциями, очередями и расширенными лимитами.',
    0,
    'RUB',
    'month',
    false,
    false,
    5000,
    100,
    50,
    100,
    20000,
    '["реальные API","очереди","S3","аудит","оформление по договору"]',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

INSERT INTO "Subscription" (
    "id",
    "workspaceId",
    "planId",
    "status",
    "provider",
    "currentPeriodStart",
    "currentPeriodEnd",
    "cancelAtPeriodEnd",
    "createdAt",
    "updatedAt"
)
SELECT
    concat('sub_', w."id"),
    w."id",
    'plan_start',
    'free',
    'none',
    date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '1 month' - INTERVAL '1 microsecond',
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Workspace" w
WHERE NOT EXISTS (
    SELECT 1 FROM "Subscription" s WHERE s."workspaceId" = w."id"
);
