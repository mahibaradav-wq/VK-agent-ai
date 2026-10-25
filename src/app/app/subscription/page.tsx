import { auth } from "@/auth";
import { SubscriptionBoard } from "@/components/app/subscription-board";
import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { getAppContext } from "@/modules/access/app-context";
import { hasPermission } from "@/modules/access/permissions";
import { createBillingService } from "@/modules/billing/billing-service";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Подписка",
  description: "Тарифы, лимиты и статус оплаты. Редирект из платежной формы не считается оплатой.",
  path: "/app/subscription",
});

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; session?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const { activeMembership } = await getAppContext(session.user.id);
  if (!activeMembership) {
    return <StatusBanner tone="warning">Нет рабочего пространства.</StatusBanner>;
  }

  const params = await searchParams;
  const billing = createBillingService(prisma);
  const state = await billing.getState(session.user.id, activeMembership.workspaceId);
  const returnCheckout =
    params.checkout === "return" && params.session
      ? await billing.getCheckout(session.user.id, activeMembership.workspaceId, params.session).catch(() => null)
      : null;

  return (
    <>
      <PageHeader
        eyebrow="Биллинг"
        title="Подписка и тарифы"
        description="Платный статус появляется только после проверки платежа в ЮKassa. Возврат со страницы оплаты сам по себе ничего не активирует."
      />
      <Container className="pb-20">
        <SubscriptionBoard
          workspaceId={activeMembership.workspaceId}
          canManage={hasPermission(activeMembership.role, "billing.manage")}
          ready={state.ready}
          provider={state.provider}
          paid={state.paid}
          returnCheckout={
            returnCheckout
              ? {
                  id: returnCheckout.id,
                  status: returnCheckout.status,
                  planName: returnCheckout.planName,
                  paid: returnCheckout.paid,
                  subscriptionStatus: returnCheckout.subscriptionStatus,
                }
              : null
          }
          subscription={{
            status: state.subscription.status,
            paidAt: state.subscription.paidAt?.toISOString() ?? null,
            currentPeriodEnd: state.subscription.currentPeriodEnd.toISOString(),
            cancelAtPeriodEnd: state.subscription.cancelAtPeriodEnd,
            plan: state.subscription.plan,
          }}
          usage={state.usage}
          plans={state.plans}
        />
      </Container>
    </>
  );
}
