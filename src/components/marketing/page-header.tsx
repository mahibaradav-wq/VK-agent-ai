import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";

export function PageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <section className="pt-16 pb-8">
      <Container className="max-w-4xl">
        <Badge>{eyebrow}</Badge>
        <h1 className="mt-5 text-4xl font-black tracking-[-0.05em] text-ink sm:text-6xl">{title}</h1>
        <p className="mt-5 text-lg leading-8 text-ink/70">{description}</p>
      </Container>
    </section>
  );
}
