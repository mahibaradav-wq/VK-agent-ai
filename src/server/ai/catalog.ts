export const aiProviderIds = ["openai"] as const;
export type AiProviderId = (typeof aiProviderIds)[number];

export type AiProviderSpec = {
  id: AiProviderId;
  label: string;
  shortLabel: string;
  baseUrl: string;
  model: string;
  imageModel: string;
  imageReady: boolean;
  keyUrl: string;
  keyHint: string;
  notes: string;
};

export const aiProviderCatalog: AiProviderSpec[] = [
  {
    id: "openai",
    label: "ChatGPT (OpenAI)",
    shortLabel: "ChatGPT",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    imageModel: "gpt-image-1.5",
    imageReady: true,
    keyUrl: "https://platform.openai.com/api-keys",
    keyHint: "Ключ с platform.openai.com, начинается с sk-. Пароль ChatGPT не подходит.",
    notes:
      "Ищет идеи, пишет посты (gpt-4o-mini) и рисует визуал (GPT Image). С IP в РФ OpenAI отвечает unsupported_country — этот сервер должен быть в ЕС.",
  },
];

export function getAiProviderSpec(id: string): AiProviderSpec {
  const spec = aiProviderCatalog.find((item) => item.id === id);
  if (!spec) {
    throw new Error(`unknown ai provider: ${id}`);
  }
  return spec;
}

export function parseAiProviderId(value: string): AiProviderId {
  if ((aiProviderIds as readonly string[]).includes(value)) {
    return value as AiProviderId;
  }
  throw new Error("unknown");
}
