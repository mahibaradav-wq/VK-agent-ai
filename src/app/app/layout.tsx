import Link from "next/link";

import { auth } from "@/auth";
import { WorkspaceSwitcher } from "@/components/app/workspace-switcher";
import { Container } from "@/components/ui/container";
import { getAppContext } from "@/modules/access/app-context";
import { createCollaborationService } from "@/modules/collaboration/collaboration-service";
import { prisma } from "@/server/db/prisma";

const appNav = [
  { href: "/app", label: "Обзор" },
  { href: "/app/calendar", label: "Календарь" },
  { href: "/app/posts", label: "Публикации" },
  { href: "/app/ai", label: "AI" },
  { href: "/app/analytics", label: "Аналитика" },
  { href: "/app/queue", label: "Очередь" },
  { href: "/app/media", label: "Медиатека" },
  { href: "/app/social-accounts", label: "Аккаунты" },
  { href: "/app/projects", label: "Проекты" },
  { href: "/app/team", label: "Команда" },
  { href: "/app/notifications", label: "Уведомления" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user?.id) {
    return children;
  }

  const context = await getAppContext(session.user.id);
  const unread = context.activeMembership
    ? await createCollaborationService(prisma).unreadCount(session.user.id, context.activeMembership.workspaceId)
    : 0;

  return (
    <>
      <Container className="pt-8">
        <nav className="mb-4 flex flex-wrap gap-4 text-sm font-semibold text-ink/70" aria-label="Кабинет">
          {appNav.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-ink">
              {item.label}
              {item.href === "/app/notifications" && unread > 0 ? ` (${unread})` : ""}
            </Link>
          ))}
        </nav>
        <WorkspaceSwitcher
          memberships={context.memberships}
          activeMembership={context.activeMembership}
          projects={context.projects}
          activeProject={context.activeProject}
        />
      </Container>
      {children}
    </>
  );
}
