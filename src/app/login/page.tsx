import Link from "next/link";

import { SetupForm } from "@/components/forms/setup-form";
import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";
import { requestAccountSetup } from "@/modules/auth/actions";

export const metadata = createPageMetadata({
  title: "Вход",
  description: "Вход в Polka Social. Авторизация будет подключена через Auth.js на следующем этапе.",
  path: "/login",
});

export default function LoginPage() {
  return (
    <>
      <PageHeader
        eyebrow="Вход"
        title="Войдите, когда авторизация будет настроена"
        description="Форма уже проверяет email и пароль. Сессия не создаётся, пока не подключён Auth.js."
      />
      <Container className="max-w-xl pb-20">
        <SetupForm
          action={requestAccountSetup}
          submitLabel="Войти"
          fields={[
            { name: "email", label: "Email", type: "email", autoComplete: "email", required: true },
            { name: "password", label: "Пароль", type: "password", autoComplete: "current-password", required: true },
          ]}
        />
        <div className="mt-6 grid gap-2 text-sm text-ink/70">
          <Link href="/forgot-password">Восстановить пароль</Link>
          <Link href="/register">Создать аккаунт</Link>
        </div>
      </Container>
    </>
  );
}
