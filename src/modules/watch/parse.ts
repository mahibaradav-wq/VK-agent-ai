import { AccessError } from "@/modules/access/permissions";

export function parseVkCommunitySource(raw: string) {
  const source = raw.trim();
  if (!source) {
    throw new AccessError(400, "Укажите ссылку или короткое имя сообщества ВКонтакте.");
  }

  let value = source
    .replace(/^https?:\/\//i, "")
    .replace(/^(?:m\.)?vk\.(?:com|ru)\//i, "")
    .replace(/^@/, "")
    .split(/[?#]/)[0]
    .replace(/\/+$/, "");

  if (!value) {
    throw new AccessError(400, "Не удалось разобрать ссылку на сообщество ВКонтакте.");
  }
  if (/^id\d+$/i.test(value) || /^users?\//i.test(value)) {
    throw new AccessError(400, "Личную страницу пользователя смотреть нельзя. Нужно сообщество или публичная страница.");
  }

  const club = /^(club|public|event)(\d+)$/i.exec(value);
  if (club) {
    return { source, screenName: `${club[1]!.toLowerCase()}${club[2]}` };
  }
  if (/^\d+$/.test(value)) {
    return { source, screenName: `club${value}` };
  }
  if (/^[a-zA-Z0-9._]+$/.test(value)) {
    return { source, screenName: value.toLowerCase() };
  }
  throw new AccessError(400, "Ожидается ссылка вида vk.com/club123 или короткое имя сообщества.");
}
