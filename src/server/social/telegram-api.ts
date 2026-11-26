import { createOutboundFetch } from "@/server/http/outbound-fetch";
import { isSocialPublishLiveEnabled, socialPublishLiveBlockedOutcome } from "@/server/social/publish-live-guard";

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

export type TelegramFilePart = {
  field: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type TelegramTransport = {
  request: (
    token: string,
    method: string,
    body?: Record<string, unknown>,
    file?: TelegramFilePart | TelegramFilePart[],
  ) => Promise<TelegramApiResult<unknown>>;
};

type TelegramJson = {
  ok: boolean;
  result?: unknown;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
};

export function telegramApiRoot() {
  return (process.env.TELEGRAM_API_BASE_URL ?? "https://api.telegram.org").replace(/\/$/, "");
}

export function createTelegramFetch(): typeof fetch {
  return createOutboundFetch();
}

const TELEGRAM_PUBLISH_METHODS = new Set([
  "sendMessage",
  "sendPhoto",
  "sendVideo",
  "sendMediaGroup",
  "sendDocument",
  "sendAudio",
  "sendAnimation",
  "sendVoice",
  "sendPoll",
  "copyMessage",
  "forwardMessage",
  "editMessageText",
  "editMessageCaption",
]);

export function createTelegramTransport(fetchImpl?: typeof fetch): TelegramTransport {
  const usingDefaultTransport = !fetchImpl;
  const activeFetch = fetchImpl ?? createTelegramFetch();

  return {
    async request(token, method, body, file) {
      if (usingDefaultTransport && TELEGRAM_PUBLISH_METHODS.has(method) && !isSocialPublishLiveEnabled()) {
        return {
          ok: false,
          error_code: 403,
          description: socialPublishLiveBlockedOutcome().message,
        };
      }
      try {
        const url = `${telegramApiRoot()}/bot${token}/${method}`;
        const files = file ? (Array.isArray(file) ? file : [file]) : [];
        const response = files.length
          ? await activeFetch(url, {
              method: "POST",
              body: (() => {
                const form = new FormData();
                for (const [key, value] of Object.entries(body ?? {})) {
                  if (value !== undefined && value !== null) {
                    form.set(key, String(value));
                  }
                }
                for (const part of files) {
                  form.set(part.field, new Blob([Buffer.from(part.bytes)], { type: part.mimeType }), part.filename);
                }
                return form;
              })(),
              signal: AbortSignal.timeout(120_000),
            })
          : await activeFetch(url, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: body ? JSON.stringify(body) : undefined,
              signal: AbortSignal.timeout(30_000),
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
