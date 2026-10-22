import type { LucideIcon } from "lucide-react";

import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

export function ProductBlock({
  eyebrow,
  title,
  description,
  points,
  href,
  cta,
  icon: Icon,
}: {
  eyebrow: string;
  title: string;
  description: string;
  points: string[];
  href: string;
  cta: string;
  icon: LucideIcon;
}) {
  return (
    <section className="py-12">
      <Container className="grid items-center gap-8 rounded-[32px] bg-white/70 p-6 shadow-soft ring-1 ring-ink/10 lg:grid-cols-[1fr_0.8fr] lg:p-10">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark">{eyebrow}</p>
          <h2 className="mt-3 text-3xl font-black tracking-[-0.04em] text-ink sm:text-4xl">{title}</h2>
          <p className="mt-4 text-lg leading-8 text-ink/70">{description}</p>
          <ul className="mt-6 grid gap-2 text-ink/80">
            {points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <ButtonLink href={href} className="mt-8">
            {cta}
          </ButtonLink>
        </div>
        <div className="flex min-h-56 items-center justify-center rounded-3xl bg-sand-50">
          <Icon className="size-16 text-brand" aria-hidden="true" />
        </div>
      </Container>
    </section>
  );
}
