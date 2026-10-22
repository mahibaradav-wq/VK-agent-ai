import Link from "next/link";

import { SetupForm } from "@/components/forms/setup-form";
import { PageHeader } from "@/components/marketing/page-header";
import { StatusBanner } from "@/components/ui/status-banner";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";
import { resetPassword } from "@/modules/auth/actions";

export const metadata = createPageMetadata({
  title: "Сброс пароля",
  description: "Установка нового пароля Polka Social по токену из локального почтового стенда.",
  path: "/reset-password",
});

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <>
      <PageHeader
        eyebrow="Сброс пароля"
        title="Задайте новый пароль"
        description="Токен проверяется на сервере. Просроченная или поддельная ссылка не меняет пароль."
      />
      <Container className="grid max-w-xl gap-6 pb-20">
        {!token ? (
          <StatusBanner tone="warning">В ссылке нет токена. Откройте письмо из локального почтового стенда.</StatusBanner>
        ) : (
          <SetupForm
            action={resetPassword}
            submitLabel="Сохранить новый пароль"
            fields={[
              { name: "token", label: "Токен", type: "hidden", defaultValue: token, required: true },
              { name: "password", label: "Новый пароль", type: "password", autoComplete: "new-password", required: true },
            ]}
          />
        )}
        <Link href="/login" className="text-sm text-ink/70">
          Вернуться ко входу
        </Link>
      </Container>
    </>
  );
}
