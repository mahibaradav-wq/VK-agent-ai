export function publicSiteUrl() {
  const raw =
    process.env.AUTH_URL ??
    process.env.SITE_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000";
  return raw.replace(/\/$/, "");
}
