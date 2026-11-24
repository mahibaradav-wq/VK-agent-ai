"use server";

export type BillingFormState = {
  status: "idle" | "invalid" | "success";
  message: string;
};

const personalCabinetBilling: BillingFormState = {
  status: "invalid",
  message: "Личный кабинет не продаёт тарифы. Checkout ЮKassa и смена подписки из UI выключены.",
};

export async function startPlanCheckout(
  _prev: BillingFormState,
  _formData: FormData,
): Promise<BillingFormState> {
  return personalCabinetBilling;
}

export async function cancelSubscription(
  _prev: BillingFormState,
  _formData: FormData,
): Promise<BillingFormState> {
  return personalCabinetBilling;
}
