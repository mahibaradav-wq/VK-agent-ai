import Link from "next/link";

import { Container } from "@/components/ui/container";
import { navItems, siteConfig } from "@/lib/site-data";

const legalLinks = [
  { href: "/privacy", label: "Политика конфиденциальности" },
  { href: "/terms", label: "Пользовательское соглашение" },
  { href: "/contacts", label: "Контакты" },
  { href: "/help", label: "Справочный центр" },
];

export function Footer() {
  return (
    <footer className="border-t border-ink/10 bg-ink text-white">
      <Container className="grid gap-10 py-12 lg:grid-cols-[1.1fr_1fr_1fr]">
        <div>
          <p className="text-xl font-black">{siteConfig.name}</p>
          <p className="mt-4 max-w-md text-sm leading-6 text-white/70">{siteConfig.description}</p>
        </div>
        <div>
          <p className="font-semibold">Продукт</p>
          <div className="mt-4 grid gap-3 text-sm text-white/70">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-white">
                {item.label}
              </Link>
            ))}
          </div>
        </div>
        <div>
          <p className="font-semibold">Документы</p>
          <div className="mt-4 grid gap-3 text-sm text-white/70">
            {legalLinks.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-white">
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </Container>
    </footer>
  );
}
