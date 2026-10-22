export type BillingCheckoutInput = {
  checkoutId: string;
  workspaceId: string;
  planSlug: string;
  successUrl: string;
  cancelUrl: string;
};

export type BillingCheckout = {
  sessionId: string;
  checkoutUrl: string;
};

export const billingEventTypes = ["payment.succeeded", "payment.failed", "subscription.canceled"] as const;
export type BillingEventType = (typeof billingEventTypes)[number];

export type VerifiedBillingEvent = {
  provider: string;
  eventId: string;
  type: BillingEventType;
  checkoutSessionId?: string;
  workspaceId?: string;
  planSlug?: string;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
  amount?: number;
  currency?: string;
  raw: unknown;
};

export type BillingProvider = {
  name: string;
  ready: boolean;
  createCheckout: (input: BillingCheckoutInput) => Promise<BillingCheckout>;
  verifyWebhook: (rawBody: string, signatureHeader: string) => Promise<VerifiedBillingEvent>;
};
