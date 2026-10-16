import { auth } from "@/auth";
import { ApproverProjectsForm, InvitationForm } from "@/components/app/collaboration-forms";
import { SetupForm } from "@/components/forms/setup-form";
import { PageHeader } from "@/components/marketing/page-header";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { getAppContext } from "@/modules/access/app-context";
import { assignableRoles, canManageMember, hasPermission } from "@/modules/access/permissions";
import { createCollaborationService } from "@/modules/collaboration/collaboration-service";
import { changeWorkspaceRole } from "@/modules/workspaces/actions";
import { createWorkspaceService } from "@/modules/workspaces/workspace-service";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Команда",
  description: "Приглашения, роли и проекты согласования текущего пространства.",
  path: "/app/team",
});

export default async function TeamPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const { activeMembership, projects } = await getAppContext(session.user.id);
  if (!activeMembership) {
    return <StatusBanner tone="warning">Нет рабочего пространства.</StatusBanner>;
  }

  const workspaceId = activeMembership.workspaceId;
  const members = await createWorkspaceService(prisma).listMembers(session.user.id, workspaceId);
  const collab = createCollaborationService(prisma);
  const invitations = await collab.listInvitations(session.user.id, workspaceId);
  const accesses = await collab.listProjectAccess(session.user.id, workspaceId);
  const canAdd = hasPermission(activeMembership.role, "members.add");
  const canChange = hasPermission(activeMembership.role, "members.changeRole");
  const roleOptions = assignableRoles(activeMembership.role).map((role) => ({ value: role, label: role }));
  const projectOptions = projects.map((project) => ({ id: project.id, name: project.name }));

  return (
    <>
      <PageHeader
        eyebrow="Команда"
        title="Роли и приглашения"
        description="Приглашение уходит в локальный почтовый стенд. Approver согласовывает только назначенные проекты."
      />
      <Container className="grid gap-6 pb-20 lg:grid-cols-[1fr_0.8fr]">
        <div className="grid gap-4">
          {members.map((member) => (
            <Card key={member.id}>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">{member.role}</p>
              <h2 className="mt-2 text-xl font-black text-ink">{member.user.email}</h2>
              {member.role === "Approver" ? (
                <p className="mt-2 text-sm text-ink/70">
                  Проекты:{" "}
                  {accesses
                    .filter((item) => item.userId === member.userId)
                    .map((item) => item.project.name)
                    .join(", ") || "не назначены"}
                </p>
              ) : null}
              {canChange && member.role === "Approver" ? (
                <ApproverProjectsForm
                  workspaceId={workspaceId}
                  userId={member.userId}
                  projects={projectOptions}
                  selectedIds={accesses.filter((item) => item.userId === member.userId).map((item) => item.projectId)}
                />
              ) : null}
              {canChange &&
              member.userId !== session.user.id &&
              canManageMember(activeMembership.role, member.role) ? (
                <div className="mt-4">
                  <SetupForm
                    action={changeWorkspaceRole}
                    submitLabel="Изменить роль"
                    fields={[
                      { name: "workspaceId", label: "Workspace", type: "hidden", defaultValue: workspaceId },
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
          {invitations.length > 0 ? (
            <Card className="grid gap-2">
              <h2 className="text-lg font-black text-ink">Ожидают ответа</h2>
              {invitations.map((invite) => (
                <p key={invite.id} className="text-sm text-ink/70">
                  {invite.email} · {invite.role} · до {invite.expiresAt.toISOString()}
                </p>
              ))}
            </Card>
          ) : null}
        </div>
        {canAdd ? (
          <Card>
            <h2 className="text-xl font-black text-ink">Пригласить участника</h2>
            <p className="mt-2 text-sm text-ink/70">
              Письмо не уходит во внешнюю почту — ссылка появится в /dev/mailbox. Пользователь может ещё не существовать.
            </p>
            <div className="mt-4">
              <InvitationForm workspaceId={workspaceId} roleOptions={roleOptions} projects={projectOptions} />
            </div>
          </Card>
        ) : (
          <StatusBanner tone="info">Приглашать могут только Admin и Owner.</StatusBanner>
        )}
      </Container>
    </>
  );
}
