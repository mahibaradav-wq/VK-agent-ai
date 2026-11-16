import Link from "next/link";

import { auth } from "@/auth";
import { Container } from "@/components/ui/container";
import { getAppContext } from "@/modules/access/app-context";
import { createAiBalanceService, safeAiBalanceLabel } from "@/modules/ai/balance-service";
import { cabinetBalanceHref, cabinetNav } from "@/modules/cabinet/nav";
import { prisma } from "@/server/db/prisma";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return children;
  }

  const { activeMembership, activeProject } = await getAppContext(userId);
  const balanceLabel = activeMembership
    ? await safeAiBalanceLabel(() => createAiBalanceService(prisma).read(userId, activeMembership.workspaceId))
    : "API";

  return (
    <>
      <Container className="pt-8">
        <nav className="mb-4 flex flex-wrap items-center gap-4 text-sm font-semibold text-ink/70" aria-label="Кабинет">
          {cabinetNav.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-ink">
              {item.label}
            </Link>
          ))}
          <Link href={cabinetBalanceHref} className="ml-auto font-black text-brand-dark hover:text-ink">
            {balanceLabel}
          </Link>
        </nav>
        {activeProject ? (
          <p className="mb-4 text-sm text-ink/60">
            Сейчас: <span className="font-semibold text-ink">{activeProject.name}</span>
            {" · "}
            <Link href="/app" className="font-semibold text-brand-dark">
              Все проекты
            </Link>
          </p>
        ) : null}
      </Container>
      {children}
    </>
  );
}
