import Link from "next/link";

import { PageHeader } from "@/components/marketing/page-header";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Личный кабинет",
  description: "Polka Social — личный кабинет, а не публичный SaaS с коммерческими тарифами.",
  path: "/pricing",
});

export default function PricingPage() {
  return (
    <>
      <PageHeader
        eyebrow="Кабинет"
        title="Коммерческие тарифы не продаются"
        description="Это личный кабинет владельца: до 10 активных проектов, ручная проверка публикаций и без checkout ЮKassa."
      />
      <Container className="max-w-2xl pb-20">
        <Card className="grid gap-4">
          <p className="text-sm leading-6 text-ink/80">
            Таблицы Plan/Subscription и webhook ЮKassa остаются в коде для обратимости и не удаляются.
            В целевом сценарии оплата, смена тарифа и публичная витрина цен не используются.
          </p>
          <p className="text-sm leading-6 text-ink/80">
            Войдите в кабинет или вернитесь на главную. Новый аккаунт на рабочем сайте создаётся только
            первым владельцем или по приглашению, если публичная регистрация закрыта.
          </p>
          <div className="flex flex-wrap gap-3 text-sm font-semibold">
            <Link href="/login" className="text-brand-dark">
              Войти
            </Link>
            <Link href="/" className="text-brand-dark">
              На главную
            </Link>
          </div>
        </Card>
      </Container>
    </>
  );
}
