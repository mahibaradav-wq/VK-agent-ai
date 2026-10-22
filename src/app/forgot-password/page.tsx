import Link from "next/link";

import { SetupForm } from "@/components/forms/setup-form";
import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";
import { requestPasswordReset } from "@/modules/auth/actions";

export const metadata = createPageMetadata({
  title: "Восстановление пароля",
  description: "Запрос сброса пароля Polka Social. Ссылка появляется в локальном почтовом стенде, письмо во внешнюю почту не отправляется.",
  path: "/forgot-password",
});

export default function ForgotPasswordPage() {
  return (
    <>
      <PageHeader
        eyebrow="Восстановление"
        title="Сброс пароля через локальный стенд"
        description="Мы не сообщаем, что письмо ушло на почту. Если аккаунт есть, ссылка появится в /dev/mailbox."
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
