import { AccessError } from "@/modules/access/permissions";

export async function probeAiApiKey(options: {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${options.apiKey}` },
    });
  } catch {
    throw new AccessError(400, "Провайдер AI недоступен. Ключ в ответ не попадает.");
  }

  if (response.status === 401 || response.status === 403) {
    throw new AccessError(400, "Провайдер отклонил ключ. Нужен API-ключ, не пароль от чата.");
  }
  if (!response.ok) {
    throw new AccessError(400, `Провайдер AI вернул ошибку ${response.status}. Ключ в ответ не попадает.`);
  }
}
