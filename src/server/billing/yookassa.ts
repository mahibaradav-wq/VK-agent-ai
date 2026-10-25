import { AccessError } from "@/modules/access/permissions";
import { PLAN_CATALOG } from "@/modules/billing/plans";
import type { BillingCheckout, BillingCheckoutInput, BillingProvider, VerifiedBillingEvent } from "@/server/billing/types";

const DEFAULT_API = "https://api.yookassa.ru/v3";

type FetchLike = typeof fetch;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function kopecksToAmount(kopecks: number) {
  return (kopecks / 100).toFixed(2);
}

export function createYookassaBillingProvider(options?: {
  shopId?: string;
  secretKey?: string;
  fetchImpl?: FetchLike;
  apiUrl?: string;
}): BillingProvider {
  const shopId = options?.shopId ?? process.env.YOOKASSA_SHOP_ID?.trim() ?? "";
  const secretKey = options?.secretKey ?? process.env.YOOKASSA_SECRET_KEY?.trim() ?? "";
  const fetchImpl = options?.fetchImpl ?? fetch;
  const apiUrl = (options?.apiUrl ?? DEFAULT_API).replace(/\/$/, "");

  function authHeader() {
    return `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString("base64")}`;
  }

  async function yookassa(path: string, init?: RequestInit) {
    const response = await fetchImpl(`${apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const text = await response.text();
    let parsed: unknown = {};
    try {
      parsed = text ? (JSON.parse(text) as unknown) : {};
    } catch {
      parsed = {};
    }
    if (!response.ok) {
      throw new AccessError(400, "ЮKassa отклонила запрос. Ключ или магазин не приняты, оплата не имитируется.");
    }
    return asRecord(parsed);
  }

  return {
    name: "yookassa",
    ready: Boolean(shopId && secretKey),
    async createCheckout(input: BillingCheckoutInput): Promise<BillingCheckout> {
      if (!shopId || !secretKey) {
        throw new AccessError(
          400,
          "Оплата недоступна: задайте YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY. Редирект не считается оплатой.",
        );
      }
      const plan = PLAN_CATALOG.find((item) => item.slug === input.planSlug);
      if (!plan || plan.priceAmount <= 0) {
        throw new AccessError(400, "Для этого тарифа нет суммы оплаты.");
      }
      const created = await yookassa("/payments", {
        method: "POST",
        headers: { "Idempotence-Key": input.checkoutId },
        body: JSON.stringify({
          amount: { value: kopecksToAmount(plan.priceAmount), currency: "RUB" },
          capture: true,
          confirmation: {
            type: "redirect",
            return_url: `${input.successUrl}?checkout=return&session=${input.checkoutId}`,
          },
          description: `Polka Social ${input.planSlug}`,
          metadata: {
            checkoutId: input.checkoutId,
            workspaceId: input.workspaceId,
            planSlug: input.planSlug,
          },
        }),
      });
      const confirmation = asRecord(created.confirmation);
      const checkoutUrl = asString(confirmation.confirmation_url);
      const sessionId = asString(created.id);
      if (!checkoutUrl || !sessionId) {
        throw new AccessError(400, "ЮKassa не вернула ссылку на оплату. Успех не имитируется.");
      }
      return { sessionId, checkoutUrl };
    },
    async verifyWebhook(rawBody: string): Promise<VerifiedBillingEvent> {
      if (!shopId || !secretKey) {
        throw new AccessError(400, "Проверка webhook недоступна: задайте YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY.");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody) as unknown;
      } catch {
        throw new AccessError(400, "Тело webhook не является JSON.");
      }
      const notification = asRecord(parsed);
      const object = asRecord(notification.object);
      const paymentId = asString(object.id);
      if (asString(notification.type) !== "notification" || !paymentId) {
        throw new AccessError(400, "Webhook ЮKassa без notification или id платежа.");
      }
      const payment = await yookassa(`/payments/${encodeURIComponent(paymentId)}`);
      const status = asString(payment.status);
      const metadata = asRecord(payment.metadata);
      const amount = asRecord(payment.amount);
      const method = asRecord(payment.payment_method);
      const checkoutSessionId = asString(metadata.checkoutId) || undefined;
      const workspaceId = asString(metadata.workspaceId) || undefined;
      const planSlug = asString(metadata.planSlug) || undefined;
      const amountValue = Number.parseFloat(asString(amount.value));

      if (status === "succeeded") {
        return {
          provider: "yookassa",
          eventId: paymentId,
          type: "payment.succeeded",
          checkoutSessionId,
          workspaceId,
          planSlug,
          providerCustomerId: asString(method.id) || undefined,
          amount: Number.isFinite(amountValue) ? Math.round(amountValue * 100) : undefined,
          currency: asString(amount.currency) || "RUB",
          raw: { notification: parsed, payment },
        };
      }
      if (status === "canceled") {
        return {
          provider: "yookassa",
          eventId: `${paymentId}:canceled`,
          type: "payment.failed",
          checkoutSessionId,
          workspaceId,
          planSlug,
          raw: { notification: parsed, payment },
        };
      }
      throw new AccessError(400, "ЮKassa ещё не подтвердила платёж. Редирект и сырой webhook не считаются оплатой.");
    },
  };
}
