import { createOutboundFetch } from "@/server/http/outbound-fetch";

export const VK_API_VERSION = "5.199";

export type VkApiFailure = {
  ok: false;
  error_code: number;
  error_msg: string;
};

export type VkApiSuccess<T> = {
  ok: true;
  response: T;
};

export type VkApiResult<T> = VkApiSuccess<T> | VkApiFailure;

export type VkResolvedScreenName = {
  type?: string;
  object_id?: number;
};

export type VkWallPost = {
  id?: number;
  owner_id?: number;
  date?: number;
  text?: string;
  likes?: { count?: number };
  comments?: { count?: number };
  views?: { count?: number };
  is_pinned?: number;
};

export type VkWallResponse = {
  count?: number;
  items?: VkWallPost[];
};

export type VkTransport = {
  call: (token: string, method: string, params?: Record<string, string | number>) => Promise<VkApiResult<unknown>>;
};

type VkJson = {
  response?: unknown;
  error?: { error_code?: number; error_msg?: string };
};

export function vkApiRoot() {
  return (process.env.VK_API_BASE_URL ?? "https://api.vk.ru").replace(/\/$/, "");
}

export function isVkAccessToken(value: string) {
  const token = value.trim();
  if (!token || /\s/.test(token) || token.includes("@")) {
    return false;
  }
  if (/^https?:\/\//i.test(token) || token.length < 40) {
    return false;
  }
  if (/^(club|public)\d+$/i.test(token)) {
    return false;
  }
  return /^(vk1\.|vk2\.)/i.test(token) || /^[A-Za-z0-9._\-/=+]{40,}$/.test(token);
}

export function createVkTransport(fetchImpl: typeof fetch = createOutboundFetch()): VkTransport {
  return {
    async call(token, method, params = {}) {
      try {
        const body = new URLSearchParams({
          access_token: token,
          v: VK_API_VERSION,
        });
        for (const [key, value] of Object.entries(params)) {
          body.set(key, String(value));
        }
        const response = await fetchImpl(`${vkApiRoot()}/method/${method}`, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            authorization: `Bearer ${token}`,
          },
          body,
          signal: AbortSignal.timeout(12_000),
        });
        const json = (await response.json()) as VkJson;
        if (json.error) {
          return {
            ok: false,
            error_code: json.error.error_code ?? response.status,
            error_msg: json.error.error_msg ?? "Ошибка VK API.",
          };
        }
        return { ok: true, response: json.response };
      } catch {
        return {
          ok: false,
          error_code: 0,
          error_msg: "Сеть до api.vk.ru недоступна, лента сообщества не прочитана.",
        };
      }
    },
  };
}

export function describeVkApiError(error: VkApiFailure) {
  if (error.error_code === 0) {
    return error.error_msg;
  }
  if (error.error_code === 5 || error.error_code === 15) {
    return `VK отклонил ключ: ${error.error_msg}`;
  }
  if (error.error_code === 27) {
    return "Этот ключ сообщества не умеет читать чужие стены. Нужен сервисный ключ приложения VK или ключ того сообщества, которое вы смотрите.";
  }
  return `VK API: ${error.error_msg}`;
}
