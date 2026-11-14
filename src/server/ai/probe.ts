import { AccessError } from "@/modules/access/permissions";
import { AI_UNAVAILABLE_MESSAGE, OPENAI_REGION_MESSAGE, isOpenAiRegionBlock } from "@/server/ai/errors";
import { createAiFetch } from "@/server/http/outbound-fetch";

export async function probeAiApiKey(options: {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = options.fetchImpl ?? createAiFetch();
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${options.apiKey}` },
    });
  } catch {
    throw new AccessError(400, AI_UNAVAILABLE_MESSAGE);
  }

  if (response.status === 401 || response.status === 403) {
    const body = await response.text().catch(() => "");
    if (isOpenAiRegionBlock(body)) {
      throw new AccessError(400, OPENAI_REGION_MESSAGE);
    }
    throw new AccessError(400, "Провайдер отклонил ключ. Нужен API-ключ, не пароль от чата.");
  }
  if (!response.ok) {
    throw new AccessError(400, `Провайдер AI вернул ошибку ${response.status}. Ключ в ответ не попадает.`);
  }
}
