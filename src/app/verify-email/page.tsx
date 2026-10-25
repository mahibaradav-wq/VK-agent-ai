import { LoginForm } from "@/components/auth/login-form";
import { ResendVerificationForm } from "@/components/auth/resend-verification-form";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/marketing/page-header";
import { StatusBanner } from "@/components/ui/status-banner";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";
import { confirmMailboxEmail, inspectEmailToken } from "@/modules/auth/actions";

export const metadata = createPageMetadata({
  title: "Подтверждение email",
  description: "Подтверждение адреса Polka Social по токену из локального почтового стенда.",
  path: "/verify-email",
});

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; confirmed?: string; email?: string; error?: string }>;
}) {
  const params = await searchParams;
  const confirmed = params.confirmed === "1" && Boolean(params.email);
  const inspected = !confirmed && params.token ? await inspectEmailToken(params.token) : null;
  const email = params.email || inspected?.email;
  const already = inspected?.status === "already";
  const pending = inspected?.status === "pending";
  const success = confirmed || already;
  const message = confirmed
    ? "Email подтверждён. Войдите в кабинет."
    : inspected?.message || (params.error === "1" ? "Не удалось подтвердить ссылку. Войдите или запросите новое письмо." : "Откройте письмо из локального почтового стенда.");

  return (
    <>
      <PageHeader
        eyebrow="Email"
        title="Подтверждение адреса"
        description="Открытие письма само по себе токен не сжигает. Подтверждение происходит только по кнопке."
      />
      <Container className="grid max-w-xl gap-6 pb-20">
        <StatusBanner tone={success ? "success" : pending ? "info" : "warning"}>{message}</StatusBanner>
        {pending && params.token ? (
          <form action={confirmMailboxEmail}>
            <input type="hidden" name="token" value={params.token} />
            <Button>Подтвердить email и открыть вход</Button>
          </form>
        ) : null}
        {success || already || params.error === "1" || inspected?.status === "invalid" || inspected?.status === "expired" ? (
          <LoginForm email={email} />
        ) : null}
        {!success && !pending ? <ResendVerificationForm email={email} /> : null}
        <ButtonLink href="/dev/mailbox" variant="secondary">
          Открыть локальный почтовый стенд
        </ButtonLink>
      </Container>
    </>
  );
}
