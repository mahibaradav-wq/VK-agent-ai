import { createOpenAiCompatibleProvider } from "@/server/ai/openai-compatible";
import { createUnconfiguredAiProvider } from "@/server/ai/unconfigured";
import type { AiProvider } from "@/server/ai/types";

export type {
  AiGenerateInput,
  AiGenerateOutput,
  AiImageInput,
  AiImageOutput,
  AiKind,
  AiLength,
  AiProvider,
  AiTone,
} from "@/server/ai/types";
export { aiKinds, aiLengths, aiTones } from "@/server/ai/types";
export { createOpenAiCompatibleProvider } from "@/server/ai/openai-compatible";
export { createUnconfiguredAiProvider } from "@/server/ai/unconfigured";

export type AiStatus = {
  ready: boolean;
  imageReady: boolean;
  provider: string;
  model: string;
  imageModel: string;
};

export function createAiProviderFromEnv(): AiProvider {
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey) {
    return createUnconfiguredAiProvider();
  }
  return createOpenAiCompatibleProvider({
    apiKey,
    baseUrl: process.env.AI_BASE_URL?.trim() || "https://api.openai.com/v1",
    model: process.env.AI_MODEL?.trim() || "gpt-4o-mini",
    imageModel: process.env.AI_IMAGE_MODEL?.trim() || "dall-e-3",
  });
}

export function getAiStatus(provider = createAiProviderFromEnv()): AiStatus {
  return {
    ready: provider.ready,
    imageReady: provider.imageReady,
    provider: provider.name,
    model: provider.ready ? provider.model : "не настроен",
    imageModel: provider.imageReady ? provider.imageModel : "не настроен",
  };
}

const globalForAi = globalThis as typeof globalThis & { aiProvider?: AiProvider };

export function getAiProvider(): AiProvider {
  globalForAi.aiProvider ??= createAiProviderFromEnv();
  return globalForAi.aiProvider;
}
