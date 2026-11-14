import { afterEach, describe, expect, it } from "vitest";

import { createTelegramTransport, isTelegramBotToken, telegramApiRoot } from "@/server/social/telegram-api";

describe("telegram Bot API transport", () => {
  const originalBase = process.env.TELEGRAM_API_BASE_URL;

  afterEach(() => {
    if (originalBase === undefined) {
      delete process.env.TELEGRAM_API_BASE_URL;
    } else {
      process.env.TELEGRAM_API_BASE_URL = originalBase;
    }
  });

  it("accepts official bot token shape", () => {
    expect(isTelegramBotToken("123456789:AAExampleTokenForTestsAbcdefghijkl")).toBe(true);
    expect(isTelegramBotToken("not-a-token")).toBe(false);
  });

  it("uses TELEGRAM_API_BASE_URL when set", async () => {
    process.env.TELEGRAM_API_BASE_URL = "https://tg-proxy.example/";
    const seen: string[] = [];
    const transport = createTelegramTransport(async (input) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ ok: true, result: { id: 1, is_bot: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    expect(telegramApiRoot()).toBe("https://tg-proxy.example");
    const result = await transport.request("1:token", "getMe");
    expect(result).toEqual({ ok: true, result: { id: 1, is_bot: true } });
    expect(seen[0]).toBe("https://tg-proxy.example/bot1:token/getMe");
  });

  it("returns error_code 0 when the network fails", async () => {
    const transport = createTelegramTransport(async () => {
      throw new Error("connect timeout");
    });
    await expect(transport.request("1:token", "getMe")).resolves.toMatchObject({
      ok: false,
      error_code: 0,
      description: "Сеть до api.telegram.org недоступна, результат неопределён.",
    });
  });
});
