import { auth } from "@/auth";
import { ProductsBoard } from "@/components/app/products-board";
import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { getAppContext } from "@/modules/access/app-context";
import { hasPermission } from "@/modules/access/permissions";
import { createProductService } from "@/modules/products/product-service";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Товары",
  description: "Ссылка магазина → карточка → Студия. В ВК — плашка и карточка товара, затем «Купить на Ozon».",
  path: "/app/products",
});

export default async function ProductsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const { activeMembership, activeProject } = await getAppContext(session.user.id);
  if (!activeMembership) {
    return <StatusBanner tone="warning">Нет рабочего пространства.</StatusBanner>;
  }
  if (!activeProject) {
    return <StatusBanner tone="warning">Сначала выберите проект.</StatusBanner>;
  }

  const products = await createProductService(prisma).list(
    session.user.id,
    activeMembership.workspaceId,
    activeProject.id,
  );
  const studioBusy = Boolean(
    await prisma.post.findFirst({
      where: {
        workspaceId: activeMembership.workspaceId,
        projectId: activeProject.id,
        status: { in: ["draft", "pending_approval", "approved"] },
        shopProduct: { isNot: null },
      },
      select: { id: true },
    }),
  );

  return (
    <>
      <PageHeader
        eyebrow="Товары"
        title={activeProject.name}
        description="Ozon, Wildberries, Маркет или Магнит. Один пост — один товар. В ленте ВК будет плашка с ценой."
      />
      <Container className="grid gap-6 pb-20">
        <ProductsBoard
          workspaceId={activeMembership.workspaceId}
          projectId={activeProject.id}
          canEdit={hasPermission(activeMembership.role, "post.create")}
          studioBusy={studioBusy}
          products={products}
        />
      </Container>
    </>
  );
}
