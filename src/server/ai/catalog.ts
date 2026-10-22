export const aiProviderIds = ["openai", "deepseek", "qwen"] as const;
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
    imageModel: "dall-e-3",
    imageReady: true,
    keyUrl: "https://platform.openai.com/api-keys",
    keyHint: "Ключ с platform.openai.com, начинается с sk-. Пароль ChatGPT не подходит.",
    notes: "Пишет текст и рисует визуал (DALL·E).",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    shortLabel: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    imageModel: "",
    imageReady: false,
    keyUrl: "https://platform.deepseek.com/api_keys",
    keyHint: "Ключ с platform.deepseek.com, начинается с sk-.",
    notes: "Пишет текст. Картинки DeepSeek не генерирует — для визуала нужен ChatGPT или Qwen.",
  },
  {
    id: "qwen",
    label: "Qwen (Квен)",
    shortLabel: "Qwen",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    imageModel: "qwen-image-plus",
    imageReady: true,
    keyUrl: "https://modelstudio.console.alibabacloud.com/",
    keyHint: "Ключ DashScope / Model Studio, начинается с sk-.",
    notes: "Пишет текст и может нарисовать визуал через совместимый Images API.",
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
