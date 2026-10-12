"use client";

import Link from "next/link";
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
  defaultValue?: string;
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
      {fields.map((field) =>
        field.type === "hidden" ? (
          <input key={field.name} type="hidden" name={field.name} defaultValue={field.defaultValue} />
        ) : (
          <label key={field.name} className="grid gap-2 text-sm font-medium text-ink">
            {field.label}
            {field.type === "textarea" ? (
              <textarea
                name={field.name}
                required={field.required}
                defaultValue={field.defaultValue}
                className="min-h-32 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal text-ink"
              />
            ) : (
              <input
                name={field.name}
                type={field.type ?? "text"}
                autoComplete={field.autoComplete}
                required={field.required}
                defaultValue={field.defaultValue}
                className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal text-ink"
              />
            )}
          </label>
        ),
      )}
      {state.message ? (
        <StatusBanner tone={state.status === "success" ? "success" : "warning"}>
          <p>{state.message}</p>
          {state.mailboxUrl ? (
            <p className="mt-2">
              <Link href={state.mailboxUrl} className="font-semibold underline">
                Открыть локальный почтовый стенд
              </Link>
            </p>
          ) : null}
        </StatusBanner>
      ) : null}
      <Button disabled={pending}>{pending ? "Проверяем..." : submitLabel}</Button>
    </form>
  );
}
