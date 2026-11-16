import { legacyRedirect } from "@/modules/cabinet/legacy-redirect";

export default async function LegacyAiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await legacyRedirect("/app/studio", searchParams);
}
