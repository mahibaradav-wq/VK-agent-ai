export const OPENAI_REGION_MESSAGE =
  "OpenAI не обслуживает регион этого сервера. Ключ не виноват и в ответ не попадает. ChatGPT нужен хостинг в ЕС — этот продукт уже работает с Amsterdam. Это не замена ответа модели.";

export const OPENAI_IMAGE_REGION_MESSAGE =
  "ChatGPT с этого IP картинки не рисует. Ключ не виноват. Нужен сервер вне РФ (этот продукт уже на Amsterdam). Это не замена картинки.";

export function isOpenAiRegionError(error: unknown) {
  return (
    error instanceof Error &&
    (error.message.includes("регион этого сервера") || error.message.includes("картинки не рисует"))
  );
}

export const AI_UNAVAILABLE_MESSAGE = "Провайдер AI недоступен. Это не замена ответа модели.";

export const AI_BALANCE_MESSAGE =
  "На счёте ChatGPT нет средств. Пополните баланс на platform.openai.com. Это не замена ответа модели.";

export function isOpenAiRegionBlock(body: string) {
  return body.includes("unsupported_country_region_territory");
}

export function isInsufficientBalance(status: number, body: string) {
  return status === 402 || /insufficient balance/i.test(body);
}

export async function readErrorBody(response: Response) {
  try {
    return await response.clone().text();
  } catch {
    return "";
  }
}
