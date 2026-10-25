import { SetupForm } from "@/components/forms/setup-form";
import { loginUser } from "@/modules/auth/actions";

export function LoginForm({ email = "" }: { email?: string }) {
  return (
    <SetupForm
      action={loginUser}
      submitLabel="Войти"
      fields={[
        {
          name: "email",
          label: "Email",
          type: "email",
          autoComplete: "email",
          required: true,
          defaultValue: email,
        },
        { name: "password", label: "Пароль", type: "password", autoComplete: "current-password", required: true },
      ]}
    />
  );
}
