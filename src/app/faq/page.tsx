import { CTASection } from "@/components/marketing/cta-section";
import { FAQ } from "@/components/marketing/faq";
import { PageHeader } from "@/components/marketing/page-header";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Частые вопросы",
  description:
    "Ответы о статусе Polka Social, реальных интеграциях, approval workflow и минимальном вертикальном срезе.",
  path: "/faq",
});

export default function FAQPage() {
  return (
    <>
      <PageHeader
        eyebrow="FAQ"
        title="Что уже можно ожидать от платформы"
        description="Мы отвечаем на вопросы о текущем этапе, а не обещаем готовый автопостинг до подключения официальных API."
      />
      <FAQ />
      <CTASection />
    </>
  );
}
