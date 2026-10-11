"use server";

export type AuthFormState = {
  status: "idle" | "setup_required" | "invalid";
  message: string;
};

function readField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function hasValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function requestAccountSetup(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = readField(formData, "email");
  const password = readField(formData, "password");

  if (!hasValidEmail(email) || password.length < 8) {
    return {
      status: "invalid",
      message: "Проверьте email и пароль. Пароль должен содержать минимум 8 символов.",
    };
  }

  return {
    status: "setup_required",
    message:
      "Требуется настройка интеграции: Auth.js и почтовый провайдер будут подключены на этапе 3. Письмо не отправлялось.",
  };
}

export async function requestPasswordReset(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = readField(formData, "email");

  if (!hasValidEmail(email)) {
    return {
      status: "invalid",
      message: "Укажите корректный email.",
    };
  }

  return {
    status: "setup_required",
    message:
      "Требуется настройка интеграции: восстановление пароля станет доступно после подключения почтового стенда. Письмо не отправлялось.",
  };
}

export async function requestContact(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = readField(formData, "email");
  const message = readField(formData, "message");

  if (!hasValidEmail(email) || message.length < 10) {
    return {
      status: "invalid",
      message: "Укажите email и сообщение не короче 10 символов.",
    };
  }

  return {
    status: "setup_required",
    message:
      "Требуется настройка интеграции: форма контактов сохранит обращения после этапа 3. Сообщение не отправлено.",
  };
}
