import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";
import { isDevMailboxEnabled } from "@/server/mail/dev-mailbox";

export function DevMailboxLink({ className }: { className?: string }) {
  if (!isDevMailboxEnabled()) {
    return null;
  }
  return (
    <Link href="/dev/mailbox" className={className}>
      Открыть локальный почтовый стенд
    </Link>
  );
}

export function DevMailboxButton() {
  if (!isDevMailboxEnabled()) {
    return null;
  }
  return (
    <ButtonLink href="/dev/mailbox" variant="secondary">
      Открыть локальный почтовый стенд
    </ButtonLink>
  );
}
