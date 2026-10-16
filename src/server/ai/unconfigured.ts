import { AccessError } from "@/modules/access/permissions";
import type { AiProvider } from "@/server/ai/types";

export function createUnconfiguredAiProvider(): AiProvider {
  return {
    name: "unconfigured",
    model: "none",
    ready: false,
    async generate() {
      throw new AccessError(
        400,
        "Генерация недоступна: требуется настройка интеграции AI. Это не ответ модели.",
      );
    },
  };
}
