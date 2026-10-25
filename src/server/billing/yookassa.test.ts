import { describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createYookassaBillingProvider } from "@/server/billing/yookassa";

const checkoutInput = {
  checkoutId: "chk_test_1",
  workspaceId: "ws_1",
  planSlug: "team",
  successUrl: "https://example.com/app/subscription",
  cancelUrl: "https://example.com/app/subscription?checkout=cancel",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("yookassa billing provider", () => {
  it("stays unready without shop credentials and does not invent a checkout URL", async () => {
    const provider = createYookassaBillingProvider({ shopId: "", secretKey: "" });
    expect(provider.ready).toBe(false);
    expect(provider.name).toBe("yookassa");
    await expect(provider.createCheckout(checkoutInput)).rejects.toBeInstanceOf(AccessError);
    await expect(provider.createCheckout(checkoutInput)).rejects.toThrow(/YOOKASSA_SHOP_ID/);
  });

  it("creates a checkout only from a real ЮKassa confirmation_url", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const provider = createYookassaBillingProvider({
      shopId: "shop-1",
      secretKey: "live-key",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse({
          id: "pay_123",
          status: "pending",
          confirmation: { type: "redirect", confirmation_url: "https://yoomoney.ru/checkout/pay_123" },
        });
      },
    });

    const checkout = await provider.createCheckout(checkoutInput);
    expect(checkout.sessionId).toBe("pay_123");
    expect(checkout.checkoutUrl).toBe("https://yoomoney.ru/checkout/pay_123");
    expect(calls[0]?.url).toBe("https://api.yookassa.ru/v3/payments");
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers["Idempotence-Key"]).toBe("chk_test_1");
    expect(headers.Authorization).toMatch(/^Basic /);
    expect(headers.Authorization).not.toContain("live-key");
    const body = JSON.parse(String(calls[0]?.init?.body)) as { amount: { value: string }; metadata: Record<string, string> };
    expect(body.amount.value).toBe("4900.00");
    expect(body.metadata.checkoutId).toBe("chk_test_1");
    expect(JSON.stringify(checkout)).not.toMatch(/live-key|shop-1/);
  });

  it("does not mark payment succeeded from the webhook body alone", async () => {
    const webhook = JSON.stringify({
      type: "notification",
      event: "payment.succeeded",
      object: { id: "pay_pending", status: "succeeded", metadata: { checkoutId: "chk_test_1" } },
    });
    const provider = createYookassaBillingProvider({
      shopId: "shop-1",
      secretKey: "live-key",
      fetchImpl: async () => jsonResponse({ id: "pay_pending", status: "pending", metadata: { checkoutId: "chk_test_1" } }),
    });
    await expect(provider.verifyWebhook(webhook, "")).rejects.toThrow(/не подтвердила платёж/);
  });

  it("activates only after ЮKassa API returns succeeded", async () => {
    const webhook = JSON.stringify({
      type: "notification",
      event: "payment.succeeded",
      object: { id: "pay_ok", status: "succeeded" },
    });
    const provider = createYookassaBillingProvider({
      shopId: "shop-1",
      secretKey: "live-key",
      fetchImpl: async (url) => {
        expect(String(url)).toBe("https://api.yookassa.ru/v3/payments/pay_ok");
        return jsonResponse({
          id: "pay_ok",
          status: "succeeded",
          amount: { value: "4900.00", currency: "RUB" },
          metadata: { checkoutId: "chk_test_1", workspaceId: "ws_1", planSlug: "team" },
          payment_method: { id: "pm_1" },
        });
      },
    });
    const event = await provider.verifyWebhook(webhook, "");
    expect(event).toMatchObject({
      provider: "yookassa",
      eventId: "pay_ok",
      type: "payment.succeeded",
      checkoutSessionId: "chk_test_1",
      workspaceId: "ws_1",
      amount: 490000,
    });
  });
});
