// VK API is reachable directly from the host. Do not send it through the
// Telegram/OpenAI CONNECT proxy: that tunnel fails with api.vk.ru.

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
  name?: string;
  screen_name?: string;
};

export type VkGroup = {
  id?: number;
  name?: string;
  screen_name?: string;
  type?: string;
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

export function extractVkGroup(response: unknown): VkGroup | null {
  if (!response) {
    return null;
  }
  if (Array.isArray(response)) {
    const first = response[0];
    return first && typeof first === "object" ? (first as VkGroup) : null;
  }
  if (typeof response !== "object") {
    return null;
  }
  const payload = response as { groups?: unknown[]; items?: unknown[]; id?: number };
  const list = payload.groups ?? payload.items;
  if (Array.isArray(list) && list[0] && typeof list[0] === "object") {
    return list[0] as VkGroup;
  }
  if (typeof payload.id === "number") {
    return payload;
  }
  return null;
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

export function createVkTransport(fetchImpl: typeof fetch = fetch): VkTransport {
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
    return "VK отклонил ключ сообщества. Для стены нужен ключ именно этого клуба с правом «Стена»; для чтения чужих стен — сервисный ключ приложения.";
  }
  if (error.error_code === 214) {
    return "VK запретил запись на стену. Нужен ключ доступа именно этого сообщества с правом «Стена», не сервисный ключ приложения.";
  }
  if (error.error_code === 1051) {
    return "Этот тип ключа VK не умеет вызывать выбранный метод. Для чтения стен нужен сервисный ключ приложения.";
  }
  return `VK API: ${error.error_msg}`;
}
