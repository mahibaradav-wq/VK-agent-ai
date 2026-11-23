export function toVkWallText(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, "$1 $2")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function vkWallCopy(title: string, body: string) {
  return [toVkWallText(title), toVkWallText(body)].filter(Boolean).join("\n\n");
}
