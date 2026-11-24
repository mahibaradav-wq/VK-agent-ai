import Link from "next/link";

import { SetupForm } from "@/components/forms/setup-form";
import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";
import { registerUser } from "@/modules/auth/actions";
import { isPublicRegistrationOpen } from "@/modules/auth/auth-service";
import { isDevMailboxEnabled } from "@/server/mail/dev-mailbox";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Регистрация",
  description: "Регистрация в Polka Social создаёт рабочее пространство.",
  path: "/register",
});

export default async function RegisterPage() {
  const ownerExists = (await prisma.user.count()) > 0;
  const registrationOpen = isPublicRegistrationOpen() || !ownerExists;

  return (
    <>
      <PageHeader
        eyebrow="Регистрация"
        title={registrationOpen ? "Создайте аккаунт владельца" : "Регистрация закрыта"}
        description={
          registrationOpen
            ? isDevMailboxEnabled()
              ? "После регистрации сразу создаётся рабочее пространство. Письмо подтверждения не уходит во внешнюю почту — оно появляется в локальном стенде."
              : "После регистрации сразу создаётся рабочее пространство. Первый владелец входит без письма."
            : "Личный кабинет уже занят владельцем. Новый аккаунт создаётся только по приглашению."
        }
      />
      <Container className="max-w-xl pb-20">
        {registrationOpen ? (
          <SetupForm
            action={registerUser}
            submitLabel="Зарегистрироваться"
            fields={[
              { name: "email", label: "Email", type: "email", autoComplete: "email", required: true },
              { name: "password", label: "Пароль", type: "password", autoComplete: "new-password", required: true },
            ]}
          />
        ) : (
          <p className="text-sm text-ink/80">Публичная регистрация выключена. Если вам прислали приглашение, откройте ссылку из письма.</p>
        )}
        <p className="mt-6 text-sm text-ink/70">
          Уже есть аккаунт? <Link href="/login">Войти</Link>
        </p>
      </Container>
    </>
  );
}
