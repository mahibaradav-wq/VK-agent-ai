import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/marketing/page-header";
import { StatusBanner } from "@/components/ui/status-banner";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";
import { mailboxActionUrl } from "@/lib/mailbox-url";
import { isDevMailboxEnabled, listDevMail } from "@/server/mail/dev-mailbox";

export const metadata = createPageMetadata({
  title: "Локальный почтовый стенд",
  description: "Письма подтверждения и сброса пароля отображаются локально и не отправляются во внешнюю почту.",
  path: "/dev/mailbox",
});

const kindCopy: Record<string, { title: string; action: string }> = {
  verify_email: { title: "Подтверждение входа", action: "Подтвердить email и открыть вход" },
  reset_password: { title: "Смена пароля", action: "Открыть форму нового пароля" },
  invitation: { title: "Приглашение в команду", action: "Открыть приглашение" },
  notification: { title: "Уведомление", action: "Открыть ссылку" },
  contact: { title: "Сообщение с сайта", action: "Открыть" },
};

function kindRank(kind: string) {
  if (kind === "verify_email") {
    return 0;
  }
  if (kind === "reset_password") {
    return 1;
  }
  return 2;
}

export default async function DevMailboxPage() {
  const enabled = isDevMailboxEnabled();
  const messages = enabled
    ? [...(await listDevMail())].sort((left, right) => {
        const rank = kindRank(left.kind) - kindRank(right.kind);
        if (rank !== 0) {
          return rank;
        }
        return right.createdAt.getTime() - left.createdAt.getTime();
      })
    : [];

  return (
    <>
      <PageHeader
        eyebrow="Dev mail"
        title="Локальный почтовый стенд"
        description="Это не внешняя почта. Сначала подтверждение входа, затем смена пароля. Ссылка открывается на этом же сайте, даже если письмо писалось на старый адрес туннеля."
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
        {messages.map((message) => {
          const copy = kindCopy[message.kind] ?? { title: message.subject, action: "Открыть ссылку из письма" };
          const href = mailboxActionUrl(message.url);
          return (
            <Card key={message.id} data-mail-to={message.to} data-mail-kind={message.kind}>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">{copy.title}</p>
              <h2 className="mt-2 text-xl font-black text-ink">{message.subject}</h2>
              <p className="mt-2 text-sm text-ink/60">Кому: {message.to}</p>
              <p className="mt-3 leading-7 text-ink/70">{message.body}</p>
              {href ? (
                <div className="mt-5">
                  <ButtonLink href={href}>{copy.action}</ButtonLink>
                </div>
              ) : null}
            </Card>
          );
        })}
      </Container>
    </>
  );
}
