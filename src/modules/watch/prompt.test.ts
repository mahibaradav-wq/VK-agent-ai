import { describe, expect, it } from "vitest";

import { ideaToAgentPrompt, watchIdeaAgentHref } from "@/modules/watch/prompt";

describe("watch idea brief", () => {
  it("turns a wall idea into an editable agent brief", () => {
    const prompt = ideaToAgentPrompt("Специи на вид || Соседи пишут про хаос на полке || Куда деть 12 баночек");
    expect(prompt).toContain("Это бриф идеи, а не готовый текст");
    expect(prompt).toContain("Тема: Специи на вид");
    expect(prompt).toContain("Почему сейчас: Соседи пишут про хаос на полке");
    expect(prompt).toContain("Хук первой строки: Куда деть 12 баночек");
  });

  it("opens the agent brief with VK as the platform", () => {
    const item = "Специи на вид || why || hook";
    const href = watchIdeaAgentHref(item);
    expect(href.startsWith("/app/studio?")).toBe(true);
    expect(href.endsWith("#agent-brief")).toBe(true);
    const query = href.slice("/app/studio?".length, href.indexOf("#"));
    const params = new URLSearchParams(query);
    expect(params.get("platform")).toBe("vk");
    expect(params.get("prompt")).toBe(ideaToAgentPrompt(item));
  });
});
