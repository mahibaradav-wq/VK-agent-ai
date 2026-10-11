import Link from "next/link";

import { SetupForm } from "@/components/forms/setup-form";
import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";
import { requestPasswordReset } from "@/modules/auth/actions";

export const metadata = createPageMetadata({
  title: "Восстановление пароля",
  description: "Запрос восстановления пароля Polka Social. Письмо не отправляется до настройки почтового стенда.",
  path: "/forgot-password",
});

export default function ForgotPasswordPage() {
  return (
    <>
      <PageHeader
        eyebrow="Восстановление"
        title="Запросите ссылку, когда почта будет подключена"
        description="Форма принимает email и честно сообщает, что письмо ещё не отправляется."
      />
      <Container className="max-w-xl pb-20">
        <SetupForm
          action={requestPasswordReset}
          submitLabel="Запросить восстановление"
          fields={[{ name: "email", label: "Email", type: "email", autoComplete: "email", required: true }]}
        />
        <p className="mt-6 text-sm text-ink/70">
          Вернуться ко <Link href="/login">входу</Link>
        </p>
      </Container>
    </>
  );
}
