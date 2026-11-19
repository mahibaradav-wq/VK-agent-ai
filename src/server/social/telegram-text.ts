export const TELEGRAM_CAPTION_LIMIT = 1024;
export const TELEGRAM_MESSAGE_LIMIT = 4096;

function cutBefore(text: string, limit: number, minKeep = Math.min(200, Math.floor(limit / 2))) {
  if (text.length <= limit) {
    return text.length;
  }
  let cut = text.lastIndexOf("\n\n", limit);
  if (cut < minKeep) {
    cut = text.lastIndexOf("\n", limit);
  }
  if (cut < minKeep) {
    cut = text.lastIndexOf(" ", limit);
  }
  return cut < minKeep ? limit : cut;
}

export function telegramCaptionAndRest(text: string) {
  if (text.length <= TELEGRAM_CAPTION_LIMIT) {
    return { caption: text, rest: "" };
  }
  const cut = cutBefore(text, TELEGRAM_CAPTION_LIMIT);
  return { caption: text.slice(0, cut).trimEnd(), rest: text.slice(cut).trimStart() };
}

export function telegramPhotoCaption(text: string) {
  return telegramCaptionAndRest(text).caption;
}

export function splitTelegramText(text: string, limit = TELEGRAM_MESSAGE_LIMIT) {
  if (!text) {
    return [];
  }
  if (text.length <= limit) {
    return [text];
  }
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const cut = cutBefore(rest, limit);
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) {
    chunks.push(rest);
  }
  return chunks;
}
