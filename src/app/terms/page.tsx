import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Пользовательское соглашение",
  description: "Условия использования публичного сайта Polka Social и ограничения текущего этапа разработки.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Документы"
        title="Пользовательское соглашение"
        description="Сервис находится в разработке. Публичный сайт описывает продукт и принимает заявки только после настройки интеграций."
      />
      <Container className="grid max-w-3xl gap-4 pb-20 text-lg leading-8 text-ink/80">
        <p>Polka Social — самостоятельный продукт. SMMplanner используется только как функциональный ориентир.</p>
        <p>Пользователь не должен ожидать реальной публикации в соцсети, пока официальная интеграция не настроена.</p>
        <p>Административные права, платежи и AI-генерация появятся отдельными этапами и будут проверяться на сервере.</p>
        <p>Используя формы сайта, вы соглашаетесь получать честный статус настройки, а не имитацию успешной операции.</p>
      </Container>
    </>
  );
}
