export function isCommercialBillingEnabled() {
  return false;
}

export const COMMERCIAL_BILLING_DISABLED_MESSAGE =
  "Личный кабинет не продаёт тарифы. Checkout, подписки и платежи ЮKassa удалены из рабочего приложения.";

export function commercialBillingGoneResponse() {
  return Response.json({ ok: false, error: COMMERCIAL_BILLING_DISABLED_MESSAGE }, { status: 410 });
}
