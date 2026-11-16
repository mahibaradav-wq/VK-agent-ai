const platformLabels: Record<string, string> = {
  telegram: "Telegram",
  vk: "ВКонтакте",
};

export function publishNowMessage(job: {
  status: string;
  lastError: string | null;
  post?: { targets: Array<{ platform: string; status: string; lastError: string | null }> };
  attempts: Array<{ kind: string; errorCode: string | null; errorMessage: string | null }>;
}) {
  const targets = job.post?.targets ?? [];
  const sent = targets
    .filter((target) => target.status === "published")
    .map((target) => platformLabels[target.platform] ?? target.platform);
  const failed = targets.filter((target) => target.status !== "published" && target.status !== "cancelled");
  if (job.status === "completed") {
    return {
      status: "success" as const,
      message: sent.length ? `Пост ушёл: ${sent.join(" и ")}.` : "Пост опубликован.",
    };
  }
  const targetError = failed.find((target) => target.lastError)?.lastError;
  const attempt = job.attempts.find((item) => item.kind !== "success");
  const detail =
    job.lastError ||
    targetError ||
    attempt?.errorMessage ||
    "VK или Telegram отклонили публикацию.";
  if (sent.length) {
    const missed = failed.map((target) => platformLabels[target.platform] ?? target.platform);
    return {
      status: "invalid" as const,
      message: `${sent.join(" и ")} уже вышли. Не ушло: ${missed.join(" и ") || "часть сетей"}. ${detail}`,
    };
  }
  return {
    status: "invalid" as const,
    message: detail.startsWith("Пост") ? detail : `Пост не вышел. ${detail}`,
  };
}
