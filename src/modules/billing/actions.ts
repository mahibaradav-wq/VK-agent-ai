"use server";

import { COMMERCIAL_BILLING_DISABLED_MESSAGE } from "@/modules/cabinet/commercial";

export type BillingFormState = {
  status: "idle" | "invalid" | "success";
  message: string;
};

const personalCabinetBilling: BillingFormState = {
  status: "invalid",
  message: COMMERCIAL_BILLING_DISABLED_MESSAGE,
};

export async function startPlanCheckout(): Promise<BillingFormState> {
  return personalCabinetBilling;
}

export async function cancelSubscription(): Promise<BillingFormState> {
  return personalCabinetBilling;
}
