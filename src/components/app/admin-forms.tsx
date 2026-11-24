"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/components/ui/status-banner";
import { grantPlatformAdmin, revokePlatformAdmin, type AdminFormState } from "@/modules/admin/actions";

const idle: AdminFormState = { status: "idle", message: "" };

export function GrantAdminForm() {
  const [state, formAction, pending] = useActionState(grantPlatformAdmin, idle);
  return (
    <form action={formAction} className="grid gap-4">
      <label className="grid gap-2 text-sm font-medium text-ink">
        Email
        <input name="email" type="email" required className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4" />
      </label>
      <label className="grid gap-2 text-sm font-medium text-ink">
        Роль
        <select name="role" defaultValue="Support" className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4">
          <option value="Support">Support</option>
          <option value="Superadmin">Superadmin</option>
        </select>
      </label>
      {state.message ? (
        <StatusBanner tone={state.status === "success" ? "success" : "warning"}>{state.message}</StatusBanner>
      ) : null}
      <Button disabled={pending}>{pending ? "Выдаём..." : "Выдать роль админки"}</Button>
    </form>
  );
}

export function RevokeAdminForm({ userId }: { userId: string }) {
  const [state, formAction, pending] = useActionState(revokePlatformAdmin, idle);
  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name="userId" value={userId} />
      {state.message ? (
        <StatusBanner tone={state.status === "success" ? "success" : "warning"}>{state.message}</StatusBanner>
      ) : null}
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Снимаем..." : "Снять роль"}
      </Button>
    </form>
  );
}
