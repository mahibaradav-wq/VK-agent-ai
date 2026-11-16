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

export type VkWallUploadFile = {
  filename: string;
  bytes: Uint8Array;
  mimeType: string;
};

export type VkWallUploadResult = {
  server: number;
  photo: string;
  hash: string;
};

export type VkSavedWallPhoto = {
  id: number;
  owner_id: number;
};

export type VkDocUploadResult = {
  file: string;
};

export type VkSavedDoc = {
  id: number;
  owner_id: number;
};

export type VkTransport = {
  call: (token: string, method: string, params?: Record<string, string | number>) => Promise<VkApiResult<unknown>>;
  uploadWallPhoto?: (uploadUrl: string, file: VkWallUploadFile) => Promise<VkApiResult<VkWallUploadResult>>;
  uploadDocument?: (uploadUrl: string, file: VkWallUploadFile) => Promise<VkApiResult<VkDocUploadResult>>;
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

function parseWallUploadPayload(payload: unknown): VkWallUploadResult | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const body = payload as { server?: unknown; photo?: unknown; hash?: unknown };
  const server = typeof body.server === "number" ? body.server : Number(body.server);
  if (!Number.isFinite(server) || typeof body.photo !== "string" || !body.photo || typeof body.hash !== "string" || !body.hash) {
    return null;
  }
  return { server, photo: body.photo, hash: body.hash };
}

function parseDocUploadPayload(payload: unknown): VkDocUploadResult | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const file = (payload as { file?: unknown }).file;
  return typeof file === "string" && file ? { file } : null;
}

export function extractSavedWallPhoto(response: unknown): VkSavedWallPhoto | null {
  const list = Array.isArray(response)
    ? response
    : response && typeof response === "object" && Array.isArray((response as { items?: unknown[] }).items)
      ? (response as { items: unknown[] }).items
      : [];
  const first = list[0];
  if (!first || typeof first !== "object") {
    return null;
  }
  const photo = first as { id?: unknown; owner_id?: unknown };
  const id = typeof photo.id === "number" ? photo.id : Number(photo.id);
  const ownerId = typeof photo.owner_id === "number" ? photo.owner_id : Number(photo.owner_id);
  if (!Number.isFinite(id) || !Number.isFinite(ownerId) || id === 0 || ownerId === 0) {
    return null;
  }
  return { id, owner_id: ownerId };
}

export function extractSavedDoc(response: unknown): VkSavedDoc | null {
  const body = response && typeof response === "object" ? (response as { doc?: unknown; type?: unknown }) : null;
  const raw =
    body && body.doc && typeof body.doc === "object"
      ? body.doc
      : Array.isArray(response)
        ? response[0]
        : response;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const doc = raw as { id?: unknown; owner_id?: unknown };
  const id = typeof doc.id === "number" ? doc.id : Number(doc.id);
  const ownerId = typeof doc.owner_id === "number" ? doc.owner_id : Number(doc.owner_id);
  if (!Number.isFinite(id) || !Number.isFinite(ownerId) || id === 0 || ownerId === 0) {
    return null;
  }
  return { id, owner_id: ownerId };
}

export function isGroupAuthUnavailable(error: VkApiFailure) {
  return error.error_code === 27;
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
    async uploadWallPhoto(uploadUrl, file) {
      try {
        const form = new FormData();
        form.append("photo", new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.filename);
        const response = await fetchImpl(uploadUrl, {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(60_000),
        });
        const json = (await response.json()) as unknown;
        const uploaded = parseWallUploadPayload(json);
        if (!uploaded) {
          return { ok: false, error_code: 0, error_msg: "VK не принял файл на загрузку стены." };
        }
        return { ok: true, response: uploaded };
      } catch {
        return {
          ok: false,
          error_code: 0,
          error_msg: "Сеть до загрузчика VK недоступна, фото на стену не отправлено.",
        };
      }
    },
    async uploadDocument(uploadUrl, file) {
      try {
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.filename);
        const response = await fetchImpl(uploadUrl, {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(60_000),
        });
        const json = (await response.json()) as unknown;
        const uploaded = parseDocUploadPayload(json);
        if (!uploaded) {
          return { ok: false, error_code: 0, error_msg: "VK не принял файл-документ на стену." };
        }
        return { ok: true, response: uploaded };
      } catch {
        return {
          ok: false,
          error_code: 0,
          error_msg: "Сеть до загрузчика документов VK недоступна.",
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
  if (error.error_code === 200) {
    return "VK запретил загрузку фото. В ключе сообщества нужны права «Стена» и «Фотографии».";
  }
  return `VK API: ${error.error_msg}`;
}
