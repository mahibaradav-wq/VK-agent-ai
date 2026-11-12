import Link from "next/link";

import { DevMailboxLink } from "@/components/auth/dev-mailbox-link";
import { LoginForm } from "@/components/auth/login-form";
import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";
import { isDevMailboxEnabled } from "@/server/mail/dev-mailbox";

export const metadata = createPageMetadata({
  title: "Вход",
  description: "Вход в Polka Social по email и паролю после подтверждения адреса.",
  path: "/login",
});

export default function LoginPage() {
  return (
    <>
      <PageHeader
        eyebrow="Вход"
        title="Войдите в рабочее пространство"
        description={
          isDevMailboxEnabled()
            ? "Неподтверждённый email не пускает в кабинет. Ссылка подтверждения находится в локальном почтовом стенде."
            : "Войдите email и паролем. Первый владелец сайта подтверждается сразу, без письма."
        }
      />
      <Container className="max-w-xl pb-20">
        <LoginForm />
        <div className="mt-6 grid gap-2 text-sm text-ink/70">
          <Link href="/forgot-password">Восстановить пароль</Link>
          <Link href="/register">Создать аккаунт</Link>
          <DevMailboxLink />
        </div>
      </Container>
    </>
  );
}
