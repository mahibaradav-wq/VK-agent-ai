import { COMMERCIAL_BILLING_DISABLED_MESSAGE } from "@/modules/cabinet/commercial";

export async function GET() {
  return Response.json({ ok: false, error: COMMERCIAL_BILLING_DISABLED_MESSAGE }, { status: 403 });
}
