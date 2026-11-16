import { auth } from "@/auth";
import { ApiBalanceBoard } from "@/components/app/api-balance-board";
import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { getAppContext } from "@/modules/access/app-context";
import { createAiBalanceService } from "@/modules/ai/balance-service";
import { formatUsd } from "@/lib/format-usd";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Счёт API",
  description: "Сколько денег осталось на ключе ChatGPT. Цифра с platform.openai.com, не выдуманная.",
  path: "/app/balance",
});

export default async function BalancePage() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const { activeMembership } = await getAppContext(session.user.id);
  if (!activeMembership) {
    return <StatusBanner tone="warning">Нет рабочего пространства.</StatusBanner>;
  }

  const balance = await createAiBalanceService(prisma).read(session.user.id, activeMembership.workspaceId);

  return (
    <>
      <PageHeader
        eyebrow="Счёт API"
        title={balance.remainingUsd == null ? "Остаток неизвестен" : formatUsd(balance.remainingUsd)}
        description="Prepaid-счёт ChatGPT. Ключ — в Подключениях. Если цифра не читается, ключ не умеет billing."
      />
      <Container className="grid gap-6 pb-20">
        <ApiBalanceBoard workspaceId={activeMembership.workspaceId} balance={balance} />
      </Container>
    </>
  );
}
