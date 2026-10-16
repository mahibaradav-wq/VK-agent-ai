import { CTASection } from "@/components/marketing/cta-section";
import { PageHeader } from "@/components/marketing/page-header";
import { PricingTable } from "@/components/marketing/pricing-table";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Тарифы",
  description:
    "Тарифные планы Polka Social. Цены и лимиты хранятся в конфигурации, платежи не имитируются до настройки провайдера.",
  path: "/pricing",
});

export default function PricingPage() {
  return (
    <>
      <PageHeader
        eyebrow="Тарифы"
        title="Выберите контур, а оплату подключите позже"
        description="Кнопки тарифов ведут на регистрацию. Оплата в кабинете подтверждается только подписанным webhook, редирект сам по себе не активирует тариф."
      />
      <PricingTable />
      <CTASection />
    </>
  );
}
