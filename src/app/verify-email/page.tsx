import { LoginForm } from "@/components/auth/login-form";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/marketing/page-header";
import { StatusBanner } from "@/components/ui/status-banner";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";
import { verifyEmailToken } from "@/modules/auth/actions";

export const metadata = createPageMetadata({
  title: "Подтверждение email",
  description: "Подтверждение адреса Polka Social по токену из локального почтового стенда.",
  path: "/verify-email",
});

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const result = token
    ? await verifyEmailToken(token)
    : { status: "invalid" as const, message: "Токен подтверждения отсутствует.", email: undefined };

  return (
    <>
      <PageHeader
        eyebrow="Email"
        title="Подтверждение адреса"
        description="После подтверждения сразу открывается форма входа. Повторно использовать ссылку нельзя."
      />
      <Container className="grid max-w-xl gap-6 pb-20">
        <StatusBanner tone={result.status === "success" ? "success" : "warning"}>{result.message}</StatusBanner>
        {result.status === "success" ? (
          <LoginForm email={result.email} />
        ) : (
          <ButtonLink href="/dev/mailbox" variant="secondary">
            Открыть локальный почтовый стенд
          </ButtonLink>
        )}
      </Container>
    </>
  );
}
