import { AlertCircle, CheckCircle2, Info } from "lucide-react";

import { cn } from "@/lib/cn";

type StatusTone = "info" | "success" | "warning";

const tones: Record<StatusTone, string> = {
  info: "bg-white text-ink ring-ink/10",
  success: "bg-success/10 text-success ring-success/20",
  warning: "bg-brand/10 text-brand-dark ring-brand/20",
};

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertCircle,
};

export function StatusBanner({
  tone = "info",
  children,
  className,
}: {
  tone?: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  const Icon = icons[tone];

  return (
    <div className={cn("flex items-start gap-3 rounded-2xl p-4 text-sm ring-1", tones[tone], className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
