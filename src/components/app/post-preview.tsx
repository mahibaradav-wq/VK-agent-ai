import { aspectRatioCss } from "@/modules/brand/visual-standard";
import { previewPlatforms, type PreviewPlatformId } from "@/modules/posts/platforms";

export function PostPreview({
  title,
  body,
  platforms,
  mediaUrls,
  aspect = "4:5",
}: {
  title: string;
  body: string;
  platforms: string[];
  mediaUrls: string[];
  aspect?: string;
}) {
  const selected = previewPlatforms.filter((item) => platforms.includes(item.id));
  const cards = selected.length
    ? selected
    : [{ id: "telegram" as PreviewPlatformId, label: "Черновик", hint: "Платформа ещё не выбрана. Живая публикация — Telegram." }];
  const mediaAspect = platforms.includes("vk") && aspect === "1:1" ? "4:5" : aspect;

  return (
    <div className="grid gap-4">
      {cards.map((platform) => (
        <article
          key={platform.id}
          className={
            platform.id === "telegram"
              ? "rounded-3xl bg-[#182533] p-4 text-white shadow-soft"
              : "rounded-3xl bg-white p-4 shadow-soft ring-1 ring-ink/10"
          }
        >
          <p className={`text-xs font-bold uppercase tracking-[0.16em] ${platform.id === "telegram" ? "text-sky-300" : "text-brand-dark"}`}>
            {platform.label}
          </p>
          {mediaUrls[0] ? (
            <div
              className="mt-3 overflow-hidden rounded-2xl bg-[#F3EEE5]"
              style={{ aspectRatio: aspectRatioCss(mediaAspect) }}
            >
              <img src={mediaUrls[0]} alt="" className="h-full w-full object-contain" />
            </div>
          ) : null}
          <h3 className="mt-3 text-lg font-black">{title || "Без названия"}</h3>
          <p className={`mt-2 whitespace-pre-wrap text-sm leading-6 ${platform.id === "telegram" ? "text-white/80" : "text-ink/70"}`}>
            {body || "Текст черновика появится здесь."}
          </p>
          <p className={`mt-3 text-xs ${platform.id === "telegram" ? "text-white/50" : "text-ink/50"}`}>{platform.hint}</p>
        </article>
      ))}
    </div>
  );
}
