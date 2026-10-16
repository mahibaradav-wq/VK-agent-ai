import Link from "next/link";

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
    : { status: "invalid" as const, message: "Токен подтверждения отсутствует." };

  return (
    <>
      <PageHeader
        eyebrow="Email"
        title="Подтверждение адреса"
        description="Токен проверяется на сервере. Повторно использовать просроченную ссылку нельзя."
      />
      <Container className="grid max-w-xl gap-6 pb-20">
        <StatusBanner tone={result.status === "success" ? "success" : "warning"}>{result.message}</StatusBanner>
        <Link href="/login" className="text-sm font-semibold text-brand-dark">
          Перейти ко входу
        </Link>
      </Container>
    </>
  );
}
