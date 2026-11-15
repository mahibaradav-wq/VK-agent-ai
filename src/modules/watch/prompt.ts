export function ideaToAgentPrompt(item: string) {
  const [titlePart, why, hook] = item.split("||").map((part) => part.trim());
  const title = titlePart || "Идея из VK";
  return [
    "Напиши готовый пост на стену ВКонтакте для сообщества «Дом по полочкам».",
    "Это бриф идеи, а не готовый текст: раскрой тему своими словами.",
    "Не копируй чужие посты, не обещай скидки, охваты и что материал уже опубликован.",
    `Тема: ${title}`,
    why ? `Почему сейчас: ${why}` : "",
    hook ? `Хук первой строки: ${hook}` : "",
    `Исходная идея: ${item}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function watchIdeaAgentHref(item: string) {
  const params = new URLSearchParams({
    prompt: ideaToAgentPrompt(item),
    platform: "vk",
  });
  return `/app/studio?${params.toString()}#agent-brief`;
}
