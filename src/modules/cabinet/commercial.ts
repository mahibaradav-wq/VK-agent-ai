export function isCommercialBillingEnabled() {
  return process.env.BILLING_CHECKOUT_ENABLED === "true";
}

export const COMMERCIAL_BILLING_DISABLED_MESSAGE =
  "Личный кабинет не продаёт тарифы. Checkout, подписки и платежи ЮKassa выключены.";
