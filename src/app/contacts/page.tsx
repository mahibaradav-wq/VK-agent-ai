import { SetupForm } from "@/components/forms/setup-form";
import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";
import { requestContact } from "@/modules/auth/actions";

export const metadata = createPageMetadata({
  title: "Контакты",
  description: "Форма обратной связи Polka Social. Сообщения не имитируют отправку до настройки почтового провайдера.",
  path: "/contacts",
});

export default function ContactsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Контакты"
        title="Напишите команде проекта"
        description="Форма проверяет поля на сервере. Если почтовый провайдер не настроен, вы увидите статус настройки, а не ложную отправку."
      />
      <Container className="max-w-xl pb-20">
        <SetupForm
          action={requestContact}
          submitLabel="Отправить сообщение"
          fields={[
            { name: "email", label: "Email", type: "email", autoComplete: "email", required: true },
            { name: "message", label: "Сообщение", type: "textarea", required: true },
          ]}
        />
      </Container>
    </>
  );
}
