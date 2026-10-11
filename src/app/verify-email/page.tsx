import Link from "next/link";

import { PageHeader } from "@/components/marketing/page-header";
import { StatusBanner } from "@/components/ui/status-banner";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Подтверждение email",
  description: "Страница подтверждения email Polka Social. Проверка токена появится после подключения Auth.js.",
  path: "/verify-email",
});

export default function VerifyEmailPage() {
  return (
    <>
      <PageHeader
        eyebrow="Email"
        title="Подтверждение адреса ещё не активно"
        description="Маршрут уже существует, чтобы ссылка из письма вела на понятную страницу, а не на 404."
      />
      <Container className="grid max-w-xl gap-6 pb-20">
        <StatusBanner tone="info">
          Требуется настройка интеграции: проверка токена подтверждения email будет добавлена на этапе 3.
        </StatusBanner>
        <Link href="/login" className="text-sm font-semibold text-brand-dark">
          Перейти ко входу
        </Link>
      </Container>
    </>
  );
}
