import Link from "next/link";

import { SetupForm } from "@/components/forms/setup-form";
import { PageHeader } from "@/components/marketing/page-header";
import { StatusBanner } from "@/components/ui/status-banner";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";
import { requestAccountSetup } from "@/modules/auth/actions";

export const metadata = createPageMetadata({
  title: "Сброс пароля",
  description: "Страница сброса пароля Polka Social. Токены восстановления появятся вместе с Auth.js.",
  path: "/reset-password",
});

export default function ResetPasswordPage() {
  return (
    <>
      <PageHeader
        eyebrow="Сброс пароля"
        title="Новый пароль пока нельзя сохранить"
        description="Страница уже существует, чтобы ссылка из письма вела на рабочий маршрут. Сохранение пароля появится на этапе авторизации."
      />
      <Container className="grid max-w-xl gap-6 pb-20">
        <StatusBanner tone="info">
          Требуется настройка интеграции: проверка токена восстановления будет добавлена вместе с Auth.js.
        </StatusBanner>
        <SetupForm
          action={requestAccountSetup}
          submitLabel="Сохранить новый пароль"
          fields={[
            { name: "email", label: "Email", type: "email", autoComplete: "email", required: true },
            { name: "password", label: "Новый пароль", type: "password", autoComplete: "new-password", required: true },
          ]}
        />
        <Link href="/login" className="text-sm text-ink/70">
          Вернуться ко входу
        </Link>
      </Container>
    </>
  );
}
