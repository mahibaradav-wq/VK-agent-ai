import { afterEach, describe, expect, it } from "vitest";

import { aiProxyUrl, telegramProxyUrl } from "@/server/http/outbound-fetch";

describe("outbound proxy split", () => {
  const previous = {
    AI_PROXY_URL: process.env.AI_PROXY_URL,
    TELEGRAM_PROXY_URL: process.env.TELEGRAM_PROXY_URL,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
  };

  afterEach(() => {
    restore("AI_PROXY_URL", previous.AI_PROXY_URL);
    restore("TELEGRAM_PROXY_URL", previous.TELEGRAM_PROXY_URL);
    restore("HTTPS_PROXY", previous.HTTPS_PROXY);
  });

  it("does not send AI through the Telegram CONNECT proxy", () => {
    process.env.TELEGRAM_PROXY_URL = "http://172.18.0.1:3128";
    delete process.env.AI_PROXY_URL;
    delete process.env.HTTPS_PROXY;
    expect(telegramProxyUrl()).toBe("http://172.18.0.1:3128");
    expect(aiProxyUrl()).toBe("");
  });

  it("uses AI_PROXY_URL only for ChatGPT egress", () => {
    process.env.AI_PROXY_URL = "http://proxy.example:3128";
    process.env.TELEGRAM_PROXY_URL = "http://172.18.0.1:3128";
    expect(aiProxyUrl()).toBe("http://proxy.example:3128");
    expect(telegramProxyUrl()).toBe("http://172.18.0.1:3128");
  });
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
