import { randomBytes } from "node:crypto";

import { AccessError } from "@/modules/access/permissions";
import { verifyBillingSignature } from "@/server/billing/signature";
import {
  billingEventTypes,
  type BillingEventType,
  type BillingProvider,
  type VerifiedBillingEvent,
} from "@/server/billing/types";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseEvent(rawBody: string, provider: string): VerifiedBillingEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    throw new AccessError(400, "Тело webhook не является JSON.");
  }
  const event = asRecord(parsed);
  const data = asRecord(event.data);
  const type = event.type;
  if (typeof event.id !== "string" || !event.id.trim()) {
    throw new AccessError(400, "В webhook нет идентификатора события.");
  }
  if (typeof type !== "string" || !(billingEventTypes as readonly string[]).includes(type)) {
    throw new AccessError(400, "Неизвестный тип billing webhook.");
  }
  return {
    provider,
    eventId: event.id.trim(),
    type: type as BillingEventType,
    checkoutSessionId: optionalString(data.checkoutSessionId),
    workspaceId: optionalString(data.workspaceId),
    planSlug: optionalString(data.planSlug),
    providerCustomerId: optionalString(data.providerCustomerId),
    providerSubscriptionId: optionalString(data.providerSubscriptionId),
    amount: optionalNumber(data.amount),
    currency: optionalString(data.currency),
    raw: parsed,
  };
}

export function createHmacBillingProvider(options?: { secret?: string; now?: () => number }): BillingProvider {
  const secret = options?.secret ?? process.env.BILLING_WEBHOOK_SECRET?.trim() ?? "";
  const now = options?.now ?? (() => Date.now());
  return {
    name: "hmac",
    ready: Boolean(secret),
    async createCheckout(input) {
      if (!secret) {
        throw new AccessError(
          400,
          "Оплата недоступна: требуется настройка BILLING_WEBHOOK_SECRET. Редирект не считается оплатой.",
        );
      }
      const url = new URL(input.successUrl);
      url.searchParams.set("checkout", "return");
      url.searchParams.set("session", input.checkoutId);
      return {
        sessionId: `cs_${randomBytes(12).toString("hex")}`,
        checkoutUrl: url.toString(),
      };
    },
    async verifyWebhook(rawBody, signatureHeader) {
      if (!secret) {
        throw new AccessError(400, "Проверка webhook недоступна: требуется настройка BILLING_WEBHOOK_SECRET.");
      }
      verifyBillingSignature(secret, signatureHeader, rawBody, now());
      return parseEvent(rawBody, "hmac");
    },
  };
}
