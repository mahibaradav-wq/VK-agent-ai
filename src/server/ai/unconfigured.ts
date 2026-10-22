import { AccessError } from "@/modules/access/permissions";
import type { AiProvider } from "@/server/ai/types";

const setupMessage = "Генерация недоступна: требуется настройка интеграции AI. Это не ответ модели.";

export function createUnconfiguredAiProvider(): AiProvider {
  return {
    name: "unconfigured",
    model: "none",
    imageModel: "none",
    ready: false,
    imageReady: false,
    async generate() {
      throw new AccessError(400, setupMessage);
    },
    async generateImage() {
      throw new AccessError(400, "Генерация визуала недоступна: требуется настройка интеграции AI. Это не картинка.");
    },
  };
}
