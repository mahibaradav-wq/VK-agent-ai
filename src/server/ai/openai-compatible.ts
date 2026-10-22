import { AccessError } from "@/modules/access/permissions";
import { detectMediaType, MAX_MEDIA_BYTES } from "@/modules/media/file-validation";
import type { AiGenerateInput, AiGenerateOutput, AiImageInput, AiImageOutput, AiProvider } from "@/server/ai/types";

type ChatResponse = {
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  choices?: Array<{ message?: { content?: string } }>;
};

function systemPrompt(input: AiGenerateInput) {
  return [
    "You are a social media copywriter for Polka Social.",
    `Task kind: ${input.kind}.`,
    `Tone: ${input.tone}.`,
    `Length: ${input.length}.`,
    input.platform ? `Adapt the copy to platform: ${input.platform}.` : "No specific platform.",
    "Reply in the same language as the user brief, default Russian.",
    'Return JSON only: {"title": string, "body": string, "items": string[]}.',
    "ideas/headline/cta/hashtags: fill items. post: fill title and body.",
  ].join(" ");
}

function parseContent(content: string, kind: string): Pick<AiGenerateOutput, "title" | "body" | "items"> {
  try {
    const parsed = JSON.parse(content) as { title?: unknown; body?: unknown; items?: unknown };
    const items = Array.isArray(parsed.items)
      ? parsed.items.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    return {
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : `AI ${kind}`,
      body: typeof parsed.body === "string" ? parsed.body : items.join("\n"),
      items,
    };
  } catch {
    return { title: `AI ${kind}`, body: content.trim(), items: [] };
  }
}

type ImageResponse = {
  data?: Array<{ b64_json?: string }>;
};

export function createOpenAiCompatibleProvider(options: {
  apiKey: string;
  baseUrl: string;
  model: string;
  imageModel?: string;
  fetchImpl?: typeof fetch;
}): AiProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const imageModel = options.imageModel?.trim() || "dall-e-3";

  return {
    name: "openai-compatible",
    model: options.model,
    imageModel,
    ready: true,
    imageReady: true,
    async generate(input: AiGenerateInput): Promise<AiGenerateOutput> {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: options.model,
            temperature: 0.7,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: systemPrompt(input) },
              { role: "user", content: input.prompt },
            ],
          }),
        });
      } catch {
        throw new AccessError(400, "Провайдер AI недоступен. Это не замена ответа модели.");
      }

      if (!response.ok) {
        throw new AccessError(400, `Провайдер AI вернул ошибку ${response.status}. Ключ в ответ не попадает.`);
      }

      const json = (await response.json()) as ChatResponse;
      const content = json.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new AccessError(400, "Провайдер AI вернул пустой ответ.");
      }
      const parsed = parseContent(content, input.kind);
      return {
        ...parsed,
        raw: content,
        provider: "openai-compatible",
        model: json.model || options.model,
        inputTokens: json.usage?.prompt_tokens,
        outputTokens: json.usage?.completion_tokens,
      };
    },
    async generateImage(input: AiImageInput): Promise<AiImageOutput> {
      const prompt = input.prompt.trim();
      if (prompt.length < 3) {
        throw new AccessError(400, "Опишите визуал минимум тремя символами.");
      }

      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/images/generations`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: imageModel,
            prompt,
            n: 1,
            size: input.size ?? "1024x1024",
            response_format: "b64_json",
          }),
        });
      } catch {
        throw new AccessError(400, "Провайдер изображений недоступен. Это не замена картинки.");
      }

      if (!response.ok) {
        throw new AccessError(400, `Провайдер изображений вернул ошибку ${response.status}. Ключ в ответ не попадает.`);
      }

      const json = (await response.json()) as ImageResponse;
      const encoded = json.data?.[0]?.b64_json;
      if (!encoded || typeof encoded !== "string") {
        throw new AccessError(400, "Провайдер изображений не вернул файл. Это не замена картинки.");
      }

      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
      } catch {
        throw new AccessError(400, "Провайдер изображений вернул повреждённые данные.");
      }

      if (bytes.byteLength === 0 || bytes.byteLength > MAX_MEDIA_BYTES) {
        throw new AccessError(400, "Сгенерированное изображение пустое или больше 8 МБ.");
      }

      const mimeType = detectMediaType(bytes);
      if (!mimeType) {
        throw new AccessError(400, "Провайдер вернул файл, который нельзя сохранить как изображение.");
      }

      return {
        bytes,
        mimeType,
        provider: "openai-compatible",
        model: imageModel,
      };
    },
  };
}
