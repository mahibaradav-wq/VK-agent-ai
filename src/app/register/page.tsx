import Link from "next/link";

import { SetupForm } from "@/components/forms/setup-form";
import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";
import { registerUser } from "@/modules/auth/actions";
import { isDevMailboxEnabled } from "@/server/mail/dev-mailbox";

export const metadata = createPageMetadata({
  title: "Регистрация",
  description: "Регистрация в Polka Social создаёт рабочее пространство.",
  path: "/register",
});

export default function RegisterPage() {
  return (
    <>
      <PageHeader
        eyebrow="Регистрация"
        title="Создайте аккаунт и workspace"
        description={
          isDevMailboxEnabled()
            ? "После регистрации сразу создаётся рабочее пространство. Письмо подтверждения не уходит во внешнюю почту — оно появляется в локальном стенде."
            : "После регистрации сразу создаётся рабочее пространство. Первый владелец входит без письма."
        }
      />
      <Container className="max-w-xl pb-20">
        <SetupForm
          action={registerUser}
          submitLabel="Зарегистрироваться"
          fields={[
            { name: "email", label: "Email", type: "email", autoComplete: "email", required: true },
            { name: "password", label: "Пароль", type: "password", autoComplete: "new-password", required: true },
          ]}
        />
        <p className="mt-6 text-sm text-ink/70">
          Уже есть аккаунт? <Link href="/login">Войти</Link>
        </p>
      </Container>
    </>
  );
}
