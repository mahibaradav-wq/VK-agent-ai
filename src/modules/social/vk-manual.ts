export const VK_MANUAL_PHOTO_CODE = "vk_manual_photo";

export const VK_MANUAL_PHOTO_MESSAGE =
  "Картинка не ушла на стену ВК как фото: ключ сообщества не умеет photos.getWallUploadServer. Telegram выходит сам по расписанию. Скачайте JPEG и выложите пост во ВКонтакте вручную. Текст без картинки на стену не отправляем.";

export function isVkManualPhoto(code?: string | null, text?: string | null) {
  return /\bvk_manual_photo\b|\bvk_photo_user_token\b/.test(`${code ?? ""} ${text ?? ""}`);
}

export function redactVkSecrets(value: string) {
  return value
    .replace(/vk[12]\.[a-z]\.[A-Za-z0-9._\-/=+]{8,}/gi, "vk[redacted]")
    .replace(/polka-vk-v2:\{[^}\n]{0,800}\}/g, "polka-vk-v2:[redacted]");
}
