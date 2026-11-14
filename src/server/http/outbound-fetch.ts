import { ProxyAgent, fetch as undiciFetch } from "undici";

export function outboundProxyUrl() {
  return (
    process.env.AI_PROXY_URL?.trim() ||
    process.env.TELEGRAM_PROXY_URL?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    ""
  );
}

export function createOutboundFetch(): typeof fetch {
  const proxy = outboundProxyUrl();
  if (!proxy) {
    return fetch;
  }
  const dispatcher = new ProxyAgent(proxy);
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    undiciFetch(String(input), { ...(init as object), dispatcher } as never)) as unknown as typeof fetch;
}
