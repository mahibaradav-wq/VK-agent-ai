import Link from "next/link";

import { SetupForm } from "@/components/forms/setup-form";
import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";
import { registerUser } from "@/modules/auth/actions";

export const metadata = createPageMetadata({
  title: "Регистрация",
  description: "Регистрация в Polka Social создаёт workspace и письмо в локальном почтовом стенде.",
  path: "/register",
});

export default function RegisterPage() {
  return (
    <>
      <PageHeader
        eyebrow="Регистрация"
        title="Создайте аккаунт и workspace"
        description="После регистрации сразу создаётся рабочее пространство. Письмо подтверждения не уходит во внешнюю почту — оно появляется в локальном стенде."
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
