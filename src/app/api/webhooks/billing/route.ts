import { AccessError } from "@/modules/access/permissions";
import { createBillingService } from "@/modules/billing/billing-service";
import { prisma } from "@/server/db/prisma";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-billing-signature") ?? "";
  try {
    const result = await createBillingService(prisma).handleWebhook(rawBody, signature);
    return Response.json({ ok: true, replay: result.replay, status: result.status });
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Webhook отклонён.";
    const status = error instanceof AccessError ? error.status : 400;
    return Response.json({ ok: false, error: message }, { status });
  }
}
