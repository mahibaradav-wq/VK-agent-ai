import Link from "next/link";

import { auth } from "@/auth";
import { WorkspaceSwitcher } from "@/components/app/workspace-switcher";
import { Container } from "@/components/ui/container";
import { getAppContext } from "@/modules/access/app-context";

const appNav = [
  { href: "/app", label: "Обзор" },
  { href: "/app/projects", label: "Проекты" },
  { href: "/app/team", label: "Команда" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user?.id) {
    return children;
  }

  const context = await getAppContext(session.user.id);

  return (
    <>
      <Container className="pt-8">
        <nav className="mb-4 flex flex-wrap gap-4 text-sm font-semibold text-ink/70" aria-label="Кабинет">
          {appNav.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-ink">
              {item.label}
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
