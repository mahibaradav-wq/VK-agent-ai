import Link from "next/link";

import { CTASection } from "@/components/marketing/cta-section";
import { PageHeader } from "@/components/marketing/page-header";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";
import { featurePages } from "@/lib/site-data";

export const metadata = createPageMetadata({
  title: "Возможности платформы",
  description:
    "Обзор модулей Polka Social: автопостинг, AI-ассистент, аналитика, редактор, медиатека и командная работа.",
  path: "/features",
});

export default function FeaturesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Возможности"
        title="Модули, которые закрывают путь от идеи до публикации"
        description="Каждый раздел ведёт на отдельную страницу с границами ответственности и текущим статусом реализации."
      />
      <Container className="grid gap-5 pb-16 md:grid-cols-2">
        {featurePages.map((feature) => (
          <Card key={feature.slug}>
            <feature.icon className="size-6 text-brand" aria-hidden="true" />
            <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">{feature.eyebrow}</p>
            <h2 className="mt-2 text-2xl font-black text-ink">{feature.title}</h2>
            <p className="mt-3 leading-7 text-ink/70">{feature.description}</p>
            <Link href={`/features/${feature.slug}`} className="mt-5 inline-flex font-semibold text-brand-dark">
              Открыть раздел
            </Link>
          </Card>
        ))}
      </Container>
      <CTASection />
    </>
  );
}
