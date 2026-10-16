import { PageHeader } from "@/components/marketing/page-header";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";
import { helpArticles } from "@/lib/site-data";

export const metadata = createPageMetadata({
  title: "Справочный центр",
  description: "Справка по текущему этапу Polka Social: публичный сайт, формы и статус настройки интеграций.",
  path: "/help",
});

export default function HelpPage() {
  return (
    <>
      <PageHeader
        eyebrow="Справка"
        title="Короткие ответы по текущему этапу"
        description="Справочный центр описывает то, что уже можно проверить на сайте, без обещаний ещё не собранных модулей."
      />
      <Container className="grid gap-5 pb-20 md:grid-cols-3">
        {helpArticles.map((article) => (
          <Card key={article.slug}>
            <h2 className="text-xl font-bold text-ink">{article.title}</h2>
            <p className="mt-3 leading-7 text-ink/70">{article.text}</p>
          </Card>
        ))}
      </Container>
    </>
  );
}
