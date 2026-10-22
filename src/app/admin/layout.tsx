import Link from "next/link";

import { auth } from "@/auth";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { isPlatformAdmin } from "@/modules/admin/access";
import { prisma } from "@/server/db/prisma";

const adminNav = [
  { href: "/admin", label: "Обзор" },
  { href: "/admin/users", label: "Пользователи" },
  { href: "/admin/workspaces", label: "Workspaces" },
  { href: "/admin/plans", label: "Тарифы" },
  { href: "/admin/integrations", label: "Интеграции" },
  { href: "/admin/queues", label: "Очереди" },
  { href: "/admin/errors", label: "Ошибки" },
  { href: "/admin/audit", label: "Audit" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    return children;
  }
  const allowed = await isPlatformAdmin(prisma, session.user.id);
  if (!allowed) {
    return (
      <Container className="py-16">
        <StatusBanner tone="warning">Недостаточно прав для админки. Доступ проверяется на сервере.</StatusBanner>
      </Container>
    );
  }

  return (
    <>
      <Container className="pt-8">
        <nav className="mb-4 flex flex-wrap gap-4 text-sm font-semibold text-ink/70" aria-label="Админка">
          {adminNav.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-ink">
              {item.label}
            </Link>
          ))}
        </nav>
      </Container>
      {children}
    </>
  );
}
