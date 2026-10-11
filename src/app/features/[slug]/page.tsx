import { notFound } from "next/navigation";

import { CTASection } from "@/components/marketing/cta-section";
import { PageHeader } from "@/components/marketing/page-header";
import { StatusBanner } from "@/components/ui/status-banner";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";
import { featureDetails, featurePages } from "@/lib/site-data";

type FeaturePageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return featurePages.map((feature) => ({ slug: feature.slug }));
}

export async function generateMetadata({ params }: FeaturePageProps) {
  const { slug } = await params;
  const feature = featurePages.find((item) => item.slug === slug);

  if (!feature) {
    return {};
  }

  return createPageMetadata({
    title: feature.title,
    description: feature.description,
    path: `/features/${feature.slug}`,
  });
}

export default async function FeatureDetailPage({ params }: FeaturePageProps) {
  const { slug } = await params;
  const feature = featurePages.find((item) => item.slug === slug);
  const details = featureDetails[slug];

  if (!feature || !details) {
    notFound();
  }

  return (
    <>
      <PageHeader eyebrow={feature.eyebrow} title={feature.title} description={feature.description} />
      <Container className="grid gap-6 pb-16">
        <ul className="grid gap-3 rounded-3xl bg-white/80 p-6 text-ink/80 shadow-soft ring-1 ring-ink/10">
          {details.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <StatusBanner tone="info">{details.outcome}</StatusBanner>
      </Container>
      <CTASection />
    </>
  );
}
