import { ProxyAgent, fetch as undiciFetch } from "undici";

export function telegramProxyUrl() {
  return process.env.TELEGRAM_PROXY_URL?.trim() || process.env.HTTPS_PROXY?.trim() || "";
}

export function aiProxyUrl() {
  return process.env.AI_PROXY_URL?.trim() || "";
}

export function outboundProxyUrl() {
  return telegramProxyUrl();
}

function fetchThrough(proxy: string): typeof fetch {
  if (!proxy) {
    return fetch;
  }
  const dispatcher = new ProxyAgent(proxy);
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    undiciFetch(String(input), { ...(init as object), dispatcher } as never)) as unknown as typeof fetch;
}

export function createOutboundFetch(): typeof fetch {
  return fetchThrough(telegramProxyUrl());
}

export function createAiFetch(): typeof fetch {
  return fetchThrough(aiProxyUrl());
}
