import { AccessError } from "@/modules/access/permissions";
import { AI_UNAVAILABLE_MESSAGE, OPENAI_REGION_MESSAGE, isOpenAiRegionBlock } from "@/server/ai/errors";
import { createAiFetch } from "@/server/http/outbound-fetch";

const PROBE_TIMEOUT_MS = 8_000;

export type AiProbeResult = {
  models: string[];
};

export async function probeAiApiKey(options: {
  apiKey: string;
  baseUrl: string;
  provider?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<AiProbeResult> {
  const fetchImpl = options.fetchImpl ?? createAiFetch();
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${options.apiKey}` },
      signal: AbortSignal.timeout(options.timeoutMs ?? PROBE_TIMEOUT_MS),
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
  try {
    const json = (await response.json()) as { data?: Array<{ id?: string }> };
    const models = Array.isArray(json.data)
      ? json.data.map((item) => (typeof item?.id === "string" ? item.id : "")).filter(Boolean)
      : [];
    return { models };
  } catch {
    return { models: [] };
  }
}
