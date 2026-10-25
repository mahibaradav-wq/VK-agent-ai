import Link from "next/link";

import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/marketing/page-header";
import { StatusBanner } from "@/components/ui/status-banner";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";
import { mailboxActionUrl, mailboxToken } from "@/lib/mailbox-url";
import { confirmMailboxEmail } from "@/modules/auth/actions";
import { countAutomatedDevMail, isDevMailboxEnabled, listDevMail } from "@/server/mail/dev-mailbox";

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

export default async function DevMailboxPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const params = await searchParams;
  const showAll = params.all === "1";
  const enabled = isDevMailboxEnabled();
  const [rawMessages, automatedCount] = enabled
    ? await Promise.all([listDevMail({ includeAutomated: showAll }), countAutomatedDevMail()])
    : [[], 0];
  const messages = [...rawMessages].sort((left, right) => {
    const rank = kindRank(left.kind) - kindRank(right.kind);
    if (rank !== 0) {
      return rank;
    }
    return right.createdAt.getTime() - left.createdAt.getTime();
  });

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
        {enabled && !showAll && automatedCount > 0 ? (
          <StatusBanner tone="info">
            Письма автопроверок (@example.test) скрыты: {automatedCount}. Подтверждайте только своё письмо.{" "}
            <Link href="/dev/mailbox?all=1" className="font-semibold underline">
              Показать все
            </Link>
          </StatusBanner>
        ) : null}
        {enabled && showAll ? (
          <StatusBanner tone="warning">
            Показаны все письма, включая автопроверки Playwright. Не подтверждайте адрес @example.test, если входите в
            свой кабинет.{" "}
            <Link href="/dev/mailbox" className="font-semibold underline">
              Скрыть тесты
            </Link>
          </StatusBanner>
        ) : null}
        {enabled && messages.length === 0 ? (
          <StatusBanner tone="info">
            {showAll
              ? "Писем пока нет. Зарегистрируйтесь или запросите сброс пароля."
              : "Писем на ваши адреса пока нет. Зарегистрируйтесь своим email — не подтверждайте письма @example.test."}
          </StatusBanner>
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
              {message.kind === "verify_email" && mailboxToken(message.url) ? (
                <form action={confirmMailboxEmail} className="mt-5">
                  <input type="hidden" name="token" value={mailboxToken(message.url)} />
                  <Button>{copy.action}</Button>
                </form>
              ) : href ? (
                <div className="mt-5">
                  <ButtonLink href={href} prefetch={false}>
                    {copy.action}
                  </ButtonLink>
                </div>
              ) : null}
            </Card>
          );
        })}
      </Container>
    </>
  );
}
