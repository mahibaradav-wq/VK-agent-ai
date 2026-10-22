import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Политика конфиденциальности",
  description: "Как Polka Social планирует обрабатывать данные пользователей после запуска авторизации и рабочих пространств.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <>
      <PageHeader
        eyebrow="Документы"
        title="Политика конфиденциальности"
        description="Документ описывает будущие правила обработки данных. На этапе 2 персональные кабинеты ещё не создаются."
      />
      <Container className="grid max-w-3xl gap-4 pb-20 text-lg leading-8 text-ink/80">
        <p>Мы не собираем платёжные данные и не храним пароли соцсетей в собственных формах.</p>
        <p>После запуска авторизации данные пользователя будут храниться в PostgreSQL и изолироваться по workspace.</p>
        <p>Секреты интеграций и OAuth-токены не должны попадать во frontend, клиентский bundle или публичные переменные окружения.</p>
        <p>Формы сайта на текущем этапе только проверяют ввод и сообщают о необходимости настройки интеграций.</p>
      </Container>
    </>
  );
}
