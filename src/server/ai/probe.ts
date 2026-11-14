import { AccessError } from "@/modules/access/permissions";
import { createOutboundFetch } from "@/server/http/outbound-fetch";

export async function probeAiApiKey(options: {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = options.fetchImpl ?? createOutboundFetch();
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
    const body = await response.text().catch(() => "");
    if (body.includes("unsupported_country_region_territory")) {
      throw new AccessError(
        400,
        "OpenAI недоступен с этого сервера по региону. Ключ в ответ не попадает.",
      );
    }
    throw new AccessError(400, "Провайдер отклонил ключ. Нужен API-ключ, не пароль от чата.");
  }
  if (!response.ok) {
    throw new AccessError(400, `Провайдер AI вернул ошибку ${response.status}. Ключ в ответ не попадает.`);
  }
}
