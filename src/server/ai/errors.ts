export const OPENAI_REGION_MESSAGE =
  "OpenAI не обслуживает регион этого сервера. Ключ не виноват и в ответ не попадает. Для текста подключите DeepSeek в разделе AI — он открывается напрямую. Это не замена ответа модели.";

export const AI_UNAVAILABLE_MESSAGE = "Провайдер AI недоступен. Это не замена ответа модели.";

export function isOpenAiRegionBlock(body: string) {
  return body.includes("unsupported_country_region_territory");
}

export async function readErrorBody(response: Response) {
  try {
    return await response.clone().text();
  } catch {
    return "";
  }
}
