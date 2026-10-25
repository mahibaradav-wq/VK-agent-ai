const MAIL_PATHS = ["/verify-email", "/reset-password", "/accept-invite"];

export function mailboxActionUrl(raw?: string | null) {
  if (!raw?.trim()) {
    return "";
  }
  const value = raw.trim();
  if (value.startsWith("/")) {
    return value;
  }
  try {
    const parsed = new URL(value);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    const match = MAIL_PATHS.find((path) => value.includes(path));
    if (!match) {
      return "";
    }
    const fromPath = value.slice(value.indexOf(match));
    return fromPath.startsWith("/") ? fromPath : `/${fromPath}`;
  }
}

export function mailboxToken(raw?: string | null) {
  const href = mailboxActionUrl(raw);
  if (!href) {
    return "";
  }
  try {
    return new URL(href, "http://mailbox.local").searchParams.get("token") ?? "";
  } catch {
    return "";
  }
}
