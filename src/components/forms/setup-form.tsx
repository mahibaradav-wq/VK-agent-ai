"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/components/ui/status-banner";
import type { AuthFormState } from "@/modules/auth/actions";

const initialState: AuthFormState = {
  status: "idle",
  message: "",
};

type Field = {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
};

export function SetupForm({
  action,
  fields,
  submitLabel,
}: {
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  fields: Field[];
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="grid gap-4">
      {fields.map((field) => (
        <label key={field.name} className="grid gap-2 text-sm font-medium text-ink">
          {field.label}
          {field.type === "textarea" ? (
            <textarea
              name={field.name}
              required={field.required}
              className="min-h-32 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal text-ink"
            />
          ) : (
            <input
              name={field.name}
              type={field.type ?? "text"}
              autoComplete={field.autoComplete}
              required={field.required}
              className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal text-ink"
            />
          )}
        </label>
      ))}
      {state.message ? (
        <StatusBanner tone={state.status === "invalid" ? "warning" : "info"}>{state.message}</StatusBanner>
      ) : null}
      <Button disabled={pending}>{pending ? "Проверяем..." : submitLabel}</Button>
    </form>
  );
}
