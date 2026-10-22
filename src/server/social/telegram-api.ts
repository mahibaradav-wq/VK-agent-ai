export type TelegramApiFailure = {
  ok: false;
  error_code: number;
  description: string;
  retry_after?: number;
};

export type TelegramApiSuccess<T> = {
  ok: true;
  result: T;
};

export type TelegramApiResult<T> = TelegramApiSuccess<T> | TelegramApiFailure;

export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
};

export type TelegramChat = {
  id: number;
  type?: string;
  title?: string;
  username?: string;
};

export type TelegramMessage = {
  message_id: number;
  chat?: TelegramChat;
};

export type TelegramTransport = {
  request: (token: string, method: string, body?: Record<string, unknown>) => Promise<TelegramApiResult<unknown>>;
};

type TelegramJson = {
  ok: boolean;
  result?: unknown;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
};

export function createTelegramTransport(fetchImpl: typeof fetch = fetch): TelegramTransport {
  return {
    async request(token, method, body) {
      try {
        const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        });
        const json = (await response.json()) as TelegramJson;
        if (json.ok) {
          return { ok: true, result: json.result };
        }
        return {
          ok: false,
          error_code: json.error_code ?? response.status,
          description: json.description ?? "Ошибка Telegram Bot API.",
          retry_after: json.parameters?.retry_after,
        };
      } catch {
        return {
          ok: false,
          error_code: 0,
          description: "Сеть до api.telegram.org недоступна, результат неопределён.",
        };
      }
    },
  };
}

export function isTelegramBotToken(value: string) {
  return /^\d+:[A-Za-z0-9_-]{20,}$/.test(value.trim());
}
