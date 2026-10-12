import { auth } from "@/auth";
import { PageHeader } from "@/components/marketing/page-header";
import { StatusBanner } from "@/components/ui/status-banner";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Кабинет",
  description: "Защищённый кабинет Polka Social. На этапе 3 доступны сессия, workspace и выход.",
  path: "/app",
});

export default async function AppHomePage() {
  const session = await auth();

  if (!session?.user?.id) {
    return null;
  }

  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: session.user.id },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <>
      <PageHeader
        eyebrow="Кабинет"
        title="Рабочее пространство создано"
        description="Это защищённый маршрут. Проекты, календарь и публикации появятся на следующих этапах."
      />
      <Container className="grid gap-5 pb-20">
        <StatusBanner tone="info">
          Вход выполнен как {session.user.email}. Данные изолированы по workspace и проверяются на сервере.
        </StatusBanner>
        {memberships.map((membership) => (
          <Card key={membership.id}>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">{membership.role}</p>
            <h2 className="mt-2 text-2xl font-black text-ink">{membership.workspace.name}</h2>
          </Card>
        ))}
      </Container>
    </>
  );
}
