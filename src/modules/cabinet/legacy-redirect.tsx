import { redirect } from "next/navigation";

export async function legacyRedirect(
  to: string,
  searchParams: Promise<Record<string, string | string[] | undefined>>,
) {
  const params = await searchParams;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value) {
      search.set(key, value);
    }
  }
  const query = search.toString();
  redirect(query ? `${to}?${query}` : to);
}
