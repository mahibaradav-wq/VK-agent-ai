import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white shadow-soft hover:-translate-y-0.5 hover:bg-ink/90",
  secondary: "bg-white text-ink ring-1 ring-ink/10 hover:-translate-y-0.5 hover:bg-sand-50",
  ghost: "text-ink hover:bg-white/70",
};

const baseClass =
  "inline-flex min-h-11 items-center justify-center rounded-full px-5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
};

export function ButtonLink({ href, children, className, variant = "primary", ...props }: ButtonLinkProps) {
  return (
    <Link href={href} className={cn(baseClass, variants[variant], className)} {...props}>
      {children}
    </Link>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export function Button({ className, variant = "primary", type = "submit", ...props }: ButtonProps) {
  return <button type={type} className={cn(baseClass, variants[variant], className)} {...props} />;
}
