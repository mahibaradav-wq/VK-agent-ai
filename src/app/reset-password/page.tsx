import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { PageHeader } from "@/components/marketing/page-header";
import { StatusBanner } from "@/components/ui/status-banner";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Сброс пароля",
  description: "Установка нового пароля Polka Social по токену из локального почтового стенда.",
  path: "/reset-password",
});

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <>
      <PageHeader
        eyebrow="Сброс пароля"
        title="Задайте новый пароль"
        description="После сохранения пароля сразу откроется форма входа. Просроченная ссылка пароль не меняет."
      />
      <Container className="grid max-w-xl gap-6 pb-20">
        {!token ? (
          <StatusBanner tone="warning">В ссылке нет токена. Откройте письмо из локального почтового стенда.</StatusBanner>
        ) : (
          <ResetPasswordForm token={token} />
        )}
      </Container>
    </>
  );
}
