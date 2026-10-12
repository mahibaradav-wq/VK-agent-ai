import { auth } from "@/auth";
import { SetupForm } from "@/components/forms/setup-form";
import { PageHeader } from "@/components/marketing/page-header";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { getAppContext } from "@/modules/access/app-context";
import { assignableRoles, canManageMember, hasPermission } from "@/modules/access/permissions";
import { addWorkspaceMember, changeWorkspaceRole } from "@/modules/workspaces/actions";
import { createWorkspaceService } from "@/modules/workspaces/workspace-service";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Команда",
  description: "Участники и роли текущего рабочего пространства.",
  path: "/app/team",
});

export default async function TeamPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const { activeMembership } = await getAppContext(session.user.id);
  if (!activeMembership) {
    return <StatusBanner tone="warning">Нет рабочего пространства.</StatusBanner>;
  }

  const members = await createWorkspaceService(prisma).listMembers(session.user.id, activeMembership.workspaceId);
  const canAdd = hasPermission(activeMembership.role, "members.add");
  const canChange = hasPermission(activeMembership.role, "members.changeRole");
  const roleOptions = assignableRoles(activeMembership.role).map((role) => ({ value: role, label: role }));

  return (
    <>
      <PageHeader
        eyebrow="Команда"
        title="Роли пространства"
        description="Участник не может повысить себя. Admin не назначает Owner и не меняет равных по рангу."
      />
      <Container className="grid gap-6 pb-20 lg:grid-cols-[1fr_0.8fr]">
        <div className="grid gap-4">
          {members.map((member) => (
            <Card key={member.id}>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">{member.role}</p>
              <h2 className="mt-2 text-xl font-black text-ink">{member.user.email}</h2>
              {canChange &&
              member.userId !== session.user.id &&
              canManageMember(activeMembership.role, member.role) ? (
                <div className="mt-4">
                  <SetupForm
                    action={changeWorkspaceRole}
                    submitLabel="Изменить роль"
                    fields={[
                      { name: "workspaceId", label: "Workspace", type: "hidden", defaultValue: activeMembership.workspaceId },
                      { name: "targetUserId", label: "User", type: "hidden", defaultValue: member.userId },
                      {
                        name: "role",
                        label: "Новая роль",
                        type: "select",
                        defaultValue: member.role === "Owner" ? "Viewer" : member.role,
                        options: roleOptions,
                      },
                    ]}
                  />
                </div>
              ) : null}
            </Card>
          ))}
        </div>
        {canAdd ? (
          <Card>
            <h2 className="text-xl font-black text-ink">Добавить участника</h2>
            <p className="mt-2 text-sm text-ink/70">Пользователь должен уже существовать. Приглашения по письму будут на этапе 11.</p>
            <div className="mt-4">
              <SetupForm
                action={addWorkspaceMember}
                submitLabel="Добавить"
                fields={[
                  { name: "workspaceId", label: "Workspace", type: "hidden", defaultValue: activeMembership.workspaceId },
                  { name: "email", label: "Email", type: "email", required: true },
                  { name: "role", label: "Роль", type: "select", defaultValue: "Viewer", options: roleOptions },
                ]}
              />
            </div>
          </Card>
        ) : (
          <StatusBanner tone="info">Добавлять участников могут только Admin и Owner.</StatusBanner>
        )}
      </Container>
    </>
  );
}
