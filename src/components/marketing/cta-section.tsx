import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

export function CTASection({
  title = "Соберите первую рабочую цепочку контента",
  description = "Регистрация откроет кабинет после подключения авторизации. Сейчас страница регистрации уже существует и честно сообщает о статусе настройки.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <section className="pb-20">
      <Container>
        <div className="rounded-[32px] bg-ink px-6 py-12 text-white shadow-soft sm:px-10">
          <h2 className="max-w-3xl text-4xl font-black tracking-[-0.04em] sm:text-5xl">{title}</h2>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-white/70">{description}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/register" variant="secondary">
              Создать аккаунт
            </ButtonLink>
            <ButtonLink href="/contacts" variant="ghost" className="text-white hover:bg-white/10">
              Связаться с командой
            </ButtonLink>
          </div>
        </div>
      </Container>
    </section>
  );
}
