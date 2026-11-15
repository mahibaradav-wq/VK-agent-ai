export const cabinetNav = [
  { href: "/app", label: "Проекты" },
  { href: "/app/calendar", label: "Календарь" },
  { href: "/app/studio", label: "Студия" },
  { href: "/app/ideas", label: "Идеи" },
  { href: "/app/products", label: "Товары" },
  { href: "/app/connections", label: "Подключения" },
] as const;

export const cabinetRedirects: Record<string, string> = {
  "/app/projects": "/app",
  "/app/ai": "/app/studio",
  "/app/watch": "/app/ideas",
  "/app/social-accounts": "/app/connections",
  "/app/posts": "/app/studio",
  "/app/analytics": "/app/calendar",
  "/app/queue": "/app/calendar",
  "/app/media": "/app/studio",
  "/app/team": "/app",
  "/app/subscription": "/app",
  "/app/notifications": "/app",
};

export const cabinetEnterPaths = ["/app/calendar", "/app/studio", "/app/ideas", "/app/products", "/app/connections"] as const;

export function isCabinetEnterPath(path: string) {
  return (cabinetEnterPaths as readonly string[]).includes(path);
}
