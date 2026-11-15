import { AccessError } from "@/modules/access/permissions";

export function parseTelegramChatSource(raw: string) {
  const value = raw.trim();
  if (!value) {
    throw new AccessError(400, "Укажите канал: t.me/dom_po_polochkam, @username или chat_id.");
  }
  if (/^-?\d+$/.test(value)) {
    return value;
  }
  const fromUrl = /^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z0-9_]+)/i.exec(value);
  const username = (fromUrl?.[1] ?? value.replace(/^@/, "")).trim();
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    throw new AccessError(400, "Это не канал Telegram. Укажите t.me/имя, @имя или числовой chat_id.");
  }
  return `@${username}`;
}
