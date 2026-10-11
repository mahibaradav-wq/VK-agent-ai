import type { LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";

type FeatureItem = {
  title: string;
  description: string;
  icon: LucideIcon;
};

export function FeatureSection({
  eyebrow,
  title,
  description,
  items,
}: {
  eyebrow: string;
  title: string;
  description: string;
  items: FeatureItem[];
}) {
  return (
    <section className="py-20">
      <Container>
        <div className="max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark">{eyebrow}</p>
          <h2 className="mt-3 text-4xl font-black tracking-[-0.04em] text-ink sm:text-5xl">{title}</h2>
          <p className="mt-4 text-lg leading-8 text-ink/70">{description}</p>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <Card key={item.title}>
              <item.icon className="size-6 text-brand" aria-hidden="true" />
              <h3 className="mt-4 text-xl font-bold text-ink">{item.title}</h3>
              <p className="mt-2 leading-7 text-ink/70">{item.description}</p>
            </Card>
          ))}
        </div>
      </Container>
    </section>
  );
}
