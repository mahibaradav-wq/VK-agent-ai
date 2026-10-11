import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

export default function NotFound() {
  return (
    <Container className="py-24">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark">404</p>
      <h1 className="mt-4 text-4xl font-black text-ink">Страница не найдена</h1>
      <p className="mt-4 max-w-xl text-lg text-ink/70">
        Проверьте адрес или вернитесь на главную. Все основные разделы сайта доступны из навигации.
      </p>
      <ButtonLink href="/" className="mt-8">
        На главную
      </ButtonLink>
    </Container>
  );
}
