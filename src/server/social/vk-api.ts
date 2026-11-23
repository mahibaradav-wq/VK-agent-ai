import dns from "node:dns";
import http from "node:http";
import https from "node:https";

import { redactVkSecrets } from "@/modules/social/vk-manual";

// VK API is reachable directly from the host. Do not send it through the
// Telegram/OpenAI CONNECT proxy: that tunnel fails with api.vk.ru.
dns.setDefaultResultOrder("ipv4first");

const UPLOAD_TIMEOUT_MS = 60_000;

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

export type VkAlbumUploadResult = {
  server: number;
  photos_list: string;
  hash: string;
};

export type VkSavedDoc = {
  id: number;
  owner_id: number;
};

export type VkVideoUploadResult = {
  video_id: number;
  owner_id: number;
};

export type VkTransport = {
  call: (token: string, method: string, params?: Record<string, string | number>) => Promise<VkApiResult<unknown>>;
  uploadWallPhoto?: (uploadUrl: string, file: VkWallUploadFile) => Promise<VkApiResult<VkWallUploadResult>>;
  uploadAlbumPhoto?: (uploadUrl: string, file: VkWallUploadFile) => Promise<VkApiResult<VkAlbumUploadResult>>;
  uploadDocument?: (uploadUrl: string, file: VkWallUploadFile) => Promise<VkApiResult<VkDocUploadResult>>;
  uploadVideo?: (uploadUrl: string, file: VkWallUploadFile) => Promise<VkApiResult<VkVideoUploadResult>>;
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

const VK_TOKEN_PACK_PREFIX = "polka-vk-v2:";

export function packVkTokens(community: string, photoUser = "") {
  const photo = photoUser.trim();
  if (!photo) {
    return community;
  }
  return `${VK_TOKEN_PACK_PREFIX}${JSON.stringify({ community, photo })}`;
}

export function unpackVkTokens(raw: string) {
  if (raw.startsWith(VK_TOKEN_PACK_PREFIX)) {
    try {
      const parsed = JSON.parse(raw.slice(VK_TOKEN_PACK_PREFIX.length)) as { community?: unknown; photo?: unknown };
      return {
        community: typeof parsed.community === "string" ? parsed.community : "",
        photo: typeof parsed.photo === "string" ? parsed.photo : "",
      };
    } catch {
      return { community: raw, photo: "" };
    }
  }
  return { community: raw, photo: "" };
}

export function resolveVkPublishTokens(raw: string) {
  const tokens = unpackVkTokens(raw);
  const community = tokens.community.trim();
  const photo = tokens.photo.trim();
  return {
    wall: community || photo,
    photo,
  };
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

export function encodeMultipartFile(field: string, file: VkWallUploadFile) {
  const boundary = `----PolkaForm${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const filename = file.filename.replace(/["\r\n]/g, "_") || "file.bin";
  const mime = file.mimeType || "application/octet-stream";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const packed = Buffer.concat([head, Buffer.from(file.bytes), tail]);
  // Plain Uint8Array, not Node Buffer: fetch forbids Content-Length as a
  // request header (UND_ERR_INVALID_ARG). A known-length typed array still
  // goes out with Content-Length set by undici, not chunked Transfer-Encoding.
  return {
    body: Uint8Array.from(packed),
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
  };
}

export function postKnownLength(
  uploadUrl: string,
  contentType: string,
  body: Uint8Array,
  timeoutMs = UPLOAD_TIMEOUT_MS,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(uploadUrl);
    } catch (error) {
      reject(error);
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      reject(new Error("VK upload URL must be http or https."));
      return;
    }
    const lib = parsed.protocol === "http:" ? http : https;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: "POST",
        family: 4,
        headers: {
          "content-type": contentType,
          "content-length": String(body.byteLength),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const status = res.statusCode && res.statusCode > 0 ? res.statusCode : 502;
          resolve(new Response(Buffer.concat(chunks), { status }));
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`VK upload timeout after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.end(Buffer.from(body));
  });
}

function networkErrorMessage(prefix: string, error: unknown) {
  const detail =
    error instanceof Error
      ? [error.name, error.message, (error as { cause?: { code?: string; message?: string } }).cause?.code]
          .filter(Boolean)
          .join(": ")
      : "unknown";
  return `${prefix} (${detail})`;
}

async function readUploadJson(response: Response) {
  const text = await response.text();
  try {
    return { json: JSON.parse(text) as unknown, text };
  } catch {
    return { json: null, text };
  }
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

function parseAlbumUploadPayload(payload: unknown): VkAlbumUploadResult | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const body = payload as { server?: unknown; photos_list?: unknown; hash?: unknown };
  const server = typeof body.server === "number" ? body.server : Number(body.server);
  if (
    !Number.isFinite(server) ||
    typeof body.photos_list !== "string" ||
    !body.photos_list ||
    typeof body.hash !== "string" ||
    !body.hash
  ) {
    return null;
  }
  return { server, photos_list: body.photos_list, hash: body.hash };
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

export function extractSavedVideo(response: unknown): VkVideoUploadResult | null {
  if (!response || typeof response !== "object") {
    return null;
  }
  const body = response as { video_id?: unknown; vid?: unknown; owner_id?: unknown };
  const idRaw = body.video_id ?? body.vid;
  const id = typeof idRaw === "number" ? idRaw : Number(idRaw);
  const ownerId = typeof body.owner_id === "number" ? body.owner_id : Number(body.owner_id);
  if (!Number.isFinite(id) || !Number.isFinite(ownerId) || id === 0 || ownerId === 0) {
    return null;
  }
  return { video_id: id, owner_id: ownerId };
}

function parseVideoUploadPayload(payload: unknown): VkVideoUploadResult | null {
  const extracted = extractSavedVideo(payload);
  if (extracted) {
    return extracted;
  }
  if (payload && typeof payload === "object" && "size" in payload) {
    return { video_id: 0, owner_id: 0 };
  }
  return null;
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
  async function postUpload(uploadUrl: string, encoded: { body: Uint8Array; headers: Record<string, string> }) {
    if (fetchImpl !== fetch) {
      return fetchImpl(uploadUrl, {
        method: "POST",
        headers: encoded.headers,
        body: encoded.body as BodyInit,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
    }
    return postKnownLength(
      uploadUrl,
      encoded.headers["content-type"] ?? "application/octet-stream",
      encoded.body,
    );
  }

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
      } catch (error) {
        return {
          ok: false,
          error_code: 0,
          error_msg: networkErrorMessage("Сеть до api.vk.ru недоступна, лента сообщества не прочитана.", error),
        };
      }
    },
    async uploadWallPhoto(uploadUrl, file) {
      try {
        const encoded = encodeMultipartFile("photo", file);
        const response = await postUpload(uploadUrl, encoded);
        const { json, text } = await readUploadJson(response);
        const uploaded = parseWallUploadPayload(json);
        if (!uploaded) {
          return {
            ok: false,
            error_code: 0,
            error_msg: `VK не принял файл на загрузку стены.${text ? ` Ответ: ${text.slice(0, 160)}` : ""}`,
          };
        }
        return { ok: true, response: uploaded };
      } catch (error) {
        return {
          ok: false,
          error_code: 0,
          error_msg: networkErrorMessage("Сеть до загрузчика VK недоступна, фото на стену не отправлено.", error),
        };
      }
    },
    async uploadAlbumPhoto(uploadUrl, file) {
      try {
        const encoded = encodeMultipartFile("file", file);
        const response = await postUpload(uploadUrl, encoded);
        const { json, text } = await readUploadJson(response);
        const uploaded = parseAlbumUploadPayload(json);
        if (!uploaded) {
          return {
            ok: false,
            error_code: 0,
            error_msg: `VK не принял файл в альбом сообщества.${text ? ` Ответ: ${text.slice(0, 160)}` : ""}`,
          };
        }
        return { ok: true, response: uploaded };
      } catch (error) {
        return {
          ok: false,
          error_code: 0,
          error_msg: networkErrorMessage("Сеть до загрузчика альбома VK недоступна.", error),
        };
      }
    },
    async uploadDocument(uploadUrl, file) {
      try {
        const encoded = encodeMultipartFile("file", file);
        const response = await postUpload(uploadUrl, encoded);
        const { json, text } = await readUploadJson(response);
        const uploaded = parseDocUploadPayload(json);
        if (!uploaded) {
          return {
            ok: false,
            error_code: 0,
            error_msg: `VK не принял файл-документ на стену.${text ? ` Ответ: ${text.slice(0, 160)}` : ""}`,
          };
        }
        return { ok: true, response: uploaded };
      } catch (error) {
        return {
          ok: false,
          error_code: 0,
          error_msg: networkErrorMessage("Сеть до загрузчика документов VK недоступна.", error),
        };
      }
    },
    async uploadVideo(uploadUrl, file) {
      try {
        const encoded = encodeMultipartFile("video_file", file);
        const response = await postUpload(uploadUrl, encoded);
        const { json, text } = await readUploadJson(response);
        const uploaded = parseVideoUploadPayload(json);
        if (!uploaded) {
          return {
            ok: false,
            error_code: 0,
            error_msg: `VK не принял ролик.${text ? ` Ответ: ${text.slice(0, 160)}` : ""}`,
          };
        }
        return { ok: true, response: uploaded };
      } catch (error) {
        return {
          ok: false,
          error_code: 0,
          error_msg: networkErrorMessage("Сеть до загрузчика видео VK недоступна.", error),
        };
      }
    },
  };
}

export function describeVkApiError(error: VkApiFailure) {
  const detail = redactVkSecrets(error.error_msg);
  if (error.error_code === 0) {
    return detail;
  }
  if (error.error_code === 5 || error.error_code === 15) {
    return `VK отклонил ключ: ${detail}`;
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
  return `VK API: ${detail}`;
}
