import { AccessError } from "@/modules/access/permissions";
import type { AiGenerateInput, AiGenerateOutput, AiProvider } from "@/server/ai/types";

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

export function createOpenAiCompatibleProvider(options: {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
}): AiProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  return {
    name: "openai-compatible",
    model: options.model,
    ready: true,
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
  };
}
