import Link from "next/link";

import { auth } from "@/auth";
import { Container } from "@/components/ui/container";
import { getAppContext } from "@/modules/access/app-context";
import { cabinetNav } from "@/modules/cabinet/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user?.id) {
    return children;
  }

  const { activeProject } = await getAppContext(session.user.id);

  return (
    <>
      <Container className="pt-8">
        <nav className="mb-4 flex flex-wrap gap-4 text-sm font-semibold text-ink/70" aria-label="Кабинет">
          {cabinetNav.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-ink">
              {item.label}
            </Link>
          ))}
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
