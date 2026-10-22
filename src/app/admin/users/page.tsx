import { GrantAdminForm, RevokeAdminForm } from "@/components/app/admin-forms";
import { PageHeader } from "@/components/marketing/page-header";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { canMutatePlatform, requirePlatformAdmin } from "@/modules/admin/access";
import { createAdminService } from "@/modules/admin/admin-service";
import { loadAdminPage } from "@/modules/admin/guard";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Пользователи",
  description: "Пользователи платформы и роли админки.",
  path: "/admin/users",
});

export default async function AdminUsersPage() {
  const { userId, data, error } = await loadAdminPage((id) => createAdminService(prisma).listUsers(id));
  if (error || !data || !userId) {
    return <StatusBanner tone="warning">{error}</StatusBanner>;
  }
  const actor = await requirePlatformAdmin(prisma, userId);
  const canMutate = canMutatePlatform(actor.admin.role);

  return (
    <>
      <PageHeader
        eyebrow="Админка"
        title="Пользователи"
        description="Выдача роли админки записывается в audit. Workspace Admin — это не роль платформы."
      />
      <Container className="grid gap-6 pb-20">
        {canMutate ? (
          <Card>
            <h2 className="text-lg font-black text-ink">Выдать роль админки</h2>
            <div className="mt-4">
              <GrantAdminForm />
            </div>
          </Card>
        ) : (
          <StatusBanner tone="info">Support видит список, но не выдаёт роли.</StatusBanner>
        )}
        {data.map((user) => (
          <Card key={user.id} className="grid gap-2">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">
              {user.adminRole ?? "участник"}
              {user.emailVerified ? "" : " · email не подтверждён"}
            </p>
            <h2 className="text-lg font-black text-ink">{user.email}</h2>
            <p className="text-sm text-ink/70">
              {user.workspaces.map((item) => `${item.name} (${item.role})`).join(" · ") || "нет workspace"}
            </p>
            {canMutate && user.adminRole && user.id !== userId ? <RevokeAdminForm userId={user.id} /> : null}
          </Card>
        ))}
      </Container>
    </>
  );
}
