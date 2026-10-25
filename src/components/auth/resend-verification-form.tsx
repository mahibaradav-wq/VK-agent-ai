"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/components/ui/status-banner";
import { resendVerification, type AuthFormState } from "@/modules/auth/actions";

const idle: AuthFormState = { status: "idle", message: "" };

export function ResendVerificationForm({ email = "" }: { email?: string }) {
  const [state, action, pending] = useActionState(resendVerification, idle);

  return (
    <form action={action} className="grid gap-4">
      <label className="grid gap-2 text-sm font-medium text-ink">
        Email для нового письма
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={email}
          className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal text-ink"
        />
      </label>
      {state.message ? (
        <StatusBanner tone={state.status === "success" ? "success" : "warning"}>
          <p>{state.message}</p>
          {state.mailboxUrl ? (
            <p className="mt-2">
              <a href={state.mailboxUrl} className="font-semibold underline">
                Открыть локальный почтовый стенд
              </a>
            </p>
          ) : null}
        </StatusBanner>
      ) : null}
      <Button disabled={pending} variant="secondary">
        {pending ? "Отправляем..." : "Прислать новое подтверждение"}
      </Button>
    </form>
  );
}
