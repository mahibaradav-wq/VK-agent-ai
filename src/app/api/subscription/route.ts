import { auth } from "@/auth";
import { AccessError } from "@/modules/access/permissions";
import { createBillingService } from "@/modules/billing/billing-service";
import { prisma } from "@/server/db/prisma";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ ok: false, error: "Нужна авторизация." }, { status: 401 });
  }
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")?.trim();
  if (!workspaceId) {
    return Response.json({ ok: false, error: "Нужен workspaceId." }, { status: 400 });
  }
  try {
    const state = await createBillingService(prisma).getState(session.user.id, workspaceId);
    return Response.json({
      ok: true,
      paid: state.paid,
      ready: state.ready,
      provider: state.provider,
      subscription: {
        status: state.subscription.status,
        paidAt: state.subscription.paidAt,
        plan: state.subscription.plan.slug,
        currentPeriodEnd: state.subscription.currentPeriodEnd,
      },
      usage: state.usage,
    });
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось получить подписку.";
    const status = error instanceof AccessError ? error.status : 400;
    return Response.json({ ok: false, error: message }, { status });
  }
}
