import Link from "next/link";

import { PageHeader } from "@/components/marketing/page-header";
import { StatusBanner } from "@/components/ui/status-banner";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";
import { isDevMailboxEnabled, listDevMail } from "@/server/mail/dev-mailbox";

export const metadata = createPageMetadata({
  title: "Локальный почтовый стенд",
  description: "Письма подтверждения и сброса пароля отображаются локально и не отправляются во внешнюю почту.",
  path: "/dev/mailbox",
});

export default async function DevMailboxPage() {
  const enabled = isDevMailboxEnabled();
  const messages = enabled ? await listDevMail() : [];

  return (
    <>
      <PageHeader
        eyebrow="Dev mail"
        title="Локальный почтовый стенд"
        description="Это не внешняя почта. Сюда попадают подтверждение, сброс пароля, приглашения и уведомления, пока почтовый провайдер не задан."
      />
      <Container className="grid gap-5 pb-20">
        {!enabled ? (
          <StatusBanner tone="warning">
            Требуется настройка интеграции: установите AUTH_DEV_MAILBOX=true, чтобы видеть локальные письма.
          </StatusBanner>
        ) : null}
        {enabled && messages.length === 0 ? (
          <StatusBanner tone="info">Писем пока нет. Зарегистрируйтесь или запросите сброс пароля.</StatusBanner>
        ) : null}
        {messages.map((message) => (
          <Card key={message.id} data-mail-to={message.to}>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">{message.kind}</p>
            <h2 className="mt-2 text-xl font-black text-ink">{message.subject}</h2>
            <p className="mt-2 text-sm text-ink/60">Кому: {message.to}</p>
            <p className="mt-3 leading-7 text-ink/70">{message.body}</p>
            {message.url ? (
              <Link href={message.url} className="mt-4 inline-flex font-semibold text-brand-dark">
                Открыть ссылку из письма
              </Link>
            ) : null}
          </Card>
        ))}
      </Container>
    </>
  );
}
