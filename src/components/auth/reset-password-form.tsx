"use client";

import { useActionState } from "react";

import { LoginForm } from "@/components/auth/login-form";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/components/ui/status-banner";
import { resetPassword, type AuthFormState } from "@/modules/auth/actions";

const idle: AuthFormState = { status: "idle", message: "" };

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword, idle);

  if (state.status === "success") {
    return (
      <div className="grid gap-6">
        <StatusBanner tone="success">{state.message}</StatusBanner>
        <LoginForm />
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="token" value={token} />
      <label className="grid gap-2 text-sm font-medium text-ink">
        Новый пароль
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal text-ink"
        />
      </label>
      {state.message ? <StatusBanner tone="warning">{state.message}</StatusBanner> : null}
      <Button disabled={pending}>{pending ? "Сохраняем..." : "Сохранить новый пароль"}</Button>
    </form>
  );
}
