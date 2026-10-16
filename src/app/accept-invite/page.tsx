import Link from "next/link";

import { auth } from "@/auth";
import { AcceptInviteForm } from "@/components/app/accept-invite-form";
import { PageHeader } from "@/components/marketing/page-header";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { AccessError } from "@/modules/access/permissions";
import { createCollaborationService } from "@/modules/collaboration/collaboration-service";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Приглашение",
  description: "Принятие приглашения в рабочее пространство Polka Social.",
  path: "/accept-invite",
});

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const session = await auth();

  let peek: { email: string; role: string; workspaceName: string } | null = null;
  let peekError = "";
  try {
    peek = await createCollaborationService(prisma).peekInvitation(token);
  } catch (error) {
    peekError = error instanceof AccessError ? error.message : "Не удалось открыть приглашение.";
  }

  return (
    <>
      <PageHeader
        eyebrow="Команда"
        title="Приглашение в пространство"
        description="Письмо лежит в локальном почтовом стенде. Внешняя почта не используется."
      />
      <Container className="max-w-xl pb-20">
        {peekError ? <StatusBanner tone="warning">{peekError}</StatusBanner> : null}
        {peek ? (
          <Card className="grid gap-4">
            <p className="text-sm text-ink/70">
              {peek.workspaceName} · роль {peek.role} · {peek.email}
            </p>
            {!session?.user?.id ? (
              <StatusBanner tone="info">
                Войдите или зарегистрируйтесь с адресом {peek.email}, подтвердите email и снова откройте ссылку из стенда.
                <span className="mt-2 flex gap-4">
                  <Link href="/login" className="font-semibold text-brand-dark">
                    Войти
                  </Link>
                  <Link href="/register" className="font-semibold text-brand-dark">
                    Регистрация
                  </Link>
                </span>
              </StatusBanner>
            ) : session.user.email !== peek.email ? (
              <StatusBanner tone="warning">
                Сейчас выполнен вход как {session.user.email}. Нужен аккаунт {peek.email}.
              </StatusBanner>
            ) : (
              <AcceptInviteForm token={token} />
            )}
          </Card>
        ) : null}
      </Container>
    </>
  );
}
