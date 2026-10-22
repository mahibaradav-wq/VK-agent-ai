"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import { cancelSubscription, startPlanCheckout, type BillingFormState } from "@/modules/billing/actions";

const idle: BillingFormState = { status: "idle", message: "" };

const statusLabels: Record<string, string> = {
  free: "Бесплатный",
  pending_payment: "Ожидает подтверждения оплаты",
  active: "Активна",
  past_due: "Просрочена",
  canceled: "Отменена",
};

type UsageMeter = { used: number; limit: number };

export function SubscriptionBoard({
  workspaceId,
  canManage,
  ready,
  provider,
  paid,
  returnCheckout,
  subscription,
  usage,
  plans,
}: {
  workspaceId: string;
  canManage: boolean;
  ready: boolean;
  provider: string;
  paid: boolean;
  returnCheckout?: {
    id: string;
    status: string;
    planName: string;
    paid: boolean;
    subscriptionStatus: string;
  } | null;
  subscription: {
    status: string;
    paidAt: string | null;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    plan: { slug: string; name: string; priceLabel: string };
  };
  usage: {
    ai: UsageMeter;
    posts: UsageMeter;
    projects: UsageMeter;
    members: UsageMeter;
    socialAccounts: UsageMeter;
  };
  plans: Array<{
    slug: string;
    name: string;
    description: string;
    priceLabel: string;
    highlighted: boolean;
    checkout: "free" | "self" | "contract";
    features: string[];
    aiGenerations: number;
    projects: number;
    socialAccounts: number;
    members: number;
    postsPerMonth: number;
  }>;
}) {
  const [checkoutState, checkoutAction, checkoutPending] = useActionState(startPlanCheckout, idle);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelSubscription, idle);

  return (
    <div className="grid gap-6">
      {!ready ? (
        <StatusBanner tone="warning">
          Требуется настройка интеграции: задайте BILLING_WEBHOOK_SECRET на сервере. Кнопка оплаты не имитирует
          успешный платёж. Секрет во frontend не передаётся.
        </StatusBanner>
      ) : (
        <StatusBanner tone="info">
          Провайдер {provider}. Оплаченным workspace становится только после проверки подписанного webhook, не после
          редиректа.
        </StatusBanner>
      )}

      {returnCheckout ? (
        <StatusBanner tone={returnCheckout.paid ? "success" : "warning"}>
          Возврат из checkout ({returnCheckout.planName}). Статус сессии: {returnCheckout.status}. Подписка:{" "}
          {statusLabels[returnCheckout.subscriptionStatus] ?? returnCheckout.subscriptionStatus}.{" "}
          {returnCheckout.paid
            ? "Оплата уже подтверждена webhook."
            : "Редирект не считается оплатой. Ждём подписанный webhook."}
        </StatusBanner>
      ) : null}

      <Card className="grid gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Текущая подписка</p>
        <h2 className="text-2xl font-black text-ink">{subscription.plan.name}</h2>
        <p className="text-ink/70">
          {subscription.plan.priceLabel} · {statusLabels[subscription.status] ?? subscription.status}
          {paid ? " · оплачена" : " · не оплачена"}
        </p>
        <p className="text-sm text-ink/60">
          Период до {new Date(subscription.currentPeriodEnd).toLocaleString("ru-RU")}
          {subscription.paidAt ? ` · paidAt ${new Date(subscription.paidAt).toLocaleString("ru-RU")}` : " · paidAt нет"}
        </p>
        {subscription.cancelAtPeriodEnd ? (
          <StatusBanner tone="info">Отмена запланирована на конец оплаченного периода.</StatusBanner>
        ) : null}
        {canManage && paid && !subscription.cancelAtPeriodEnd ? (
          <form action={cancelAction} className="grid gap-3">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            {cancelState.message ? (
              <StatusBanner tone={cancelState.status === "success" ? "success" : "warning"}>
                {cancelState.message}
              </StatusBanner>
            ) : null}
            <Button type="submit" variant="secondary" disabled={cancelPending}>
              {cancelPending ? "Отменяем..." : "Отменить в конце периода"}
            </Button>
          </form>
        ) : null}
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {(
          [
            ["AI", usage.ai],
            ["Публикации", usage.posts],
            ["Проекты", usage.projects],
            ["Участники", usage.members],
            ["Аккаунты", usage.socialAccounts],
          ] as Array<[string, UsageMeter]>
        ).map(([label, meter]) => (
          <Card key={label}>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">{label}</p>
            <p className="mt-2 text-2xl font-black text-ink">
              {meter.used}/{meter.limit}
            </p>
          </Card>
        ))}
      </div>

      {checkoutState.message ? (
        <StatusBanner tone={checkoutState.status === "success" ? "success" : "warning"}>
          {checkoutState.message}
        </StatusBanner>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        {plans.map((plan) => (
          <Card key={plan.slug} className={plan.highlighted ? "bg-ink text-white" : undefined}>
            <p className={plan.highlighted ? "text-white/70" : "text-ink/60"}>{plan.name}</p>
            <p className="mt-3 text-3xl font-black">{plan.priceLabel}</p>
            <p className={`mt-3 leading-7 ${plan.highlighted ? "text-white/70" : "text-ink/70"}`}>{plan.description}</p>
            <ul className="mt-6 grid gap-2 text-sm">
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            {plan.checkout === "self" && canManage ? (
              <form action={checkoutAction} className="mt-8">
                <input type="hidden" name="workspaceId" value={workspaceId} />
                <input type="hidden" name="planSlug" value={plan.slug} />
                <Button
                  type="submit"
                  variant={plan.highlighted ? "secondary" : "primary"}
                  className="w-full"
                  disabled={checkoutPending}
                >
                  {checkoutPending ? "Открываем оплату..." : `Перейти к оплате ${plan.name}`}
                </Button>
              </form>
            ) : (
              <p className={`mt-8 text-sm ${plan.highlighted ? "text-white/70" : "text-ink/60"}`}>
                {plan.checkout === "free"
                  ? "Текущий бесплатный контур. Оплата не требуется."
                  : plan.checkout === "contract"
                    ? "Оформляется по договору, не через checkout."
                    : "Оплату может запустить Owner или Admin."}
              </p>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
