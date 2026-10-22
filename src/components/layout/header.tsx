import Link from "next/link";

import { auth, signOut } from "@/auth";
import { Button, ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { navItems, siteConfig } from "@/lib/site-data";
import { isPlatformAdmin } from "@/modules/admin/access";
import { prisma } from "@/server/db/prisma";

export async function Header() {
  const session = await auth();
  const showAdmin = session?.user?.id ? await isPlatformAdmin(prisma, session.user.id) : false;

  return (
    <header className="sticky top-0 z-50 border-b border-ink/10 bg-cream/85 backdrop-blur-xl">
      <Container className="flex min-h-16 items-center justify-between gap-6">
        <Link href="/" className="text-lg font-black tracking-tight text-ink">
          {siteConfig.name}
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-medium text-ink/70 lg:flex" aria-label="Основная навигация">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="transition hover:text-ink">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {session?.user ? (
            <>
              <ButtonLink href="/app" variant="ghost" className="hidden sm:inline-flex">
                Кабинет
              </ButtonLink>
              {showAdmin ? (
                <ButtonLink href="/admin" variant="ghost" className="hidden sm:inline-flex">
                  Админка
                </ButtonLink>
              ) : null}
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <Button type="submit" variant="secondary">
                  Выйти
                </Button>
              </form>
            </>
          ) : (
            <>
              <ButtonLink href="/login" variant="ghost" className="hidden sm:inline-flex">
                Вход
              </ButtonLink>
              <ButtonLink href="/register">Начать</ButtonLink>
            </>
          )}
        </div>
      </Container>
      <details className="border-t border-ink/10 lg:hidden">
        <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-ink">Меню</summary>
        <nav className="grid gap-3 px-5 pb-4 text-sm font-medium text-ink/80" aria-label="Мобильная навигация">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
          {session?.user ? <Link href="/app">Кабинет</Link> : <Link href="/login">Вход</Link>}
          {showAdmin ? <Link href="/admin">Админка</Link> : null}
        </nav>
      </details>
    </header>
  );
}
