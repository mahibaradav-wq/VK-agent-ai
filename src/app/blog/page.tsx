import Link from "next/link";

import { PageHeader } from "@/components/marketing/page-header";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { createPageMetadata } from "@/lib/metadata";
import { blogPosts } from "@/lib/site-data";

export const metadata = createPageMetadata({
  title: "Блог",
  description: "Заметки о безопасном автопостинге, AI-ассистенте и серверной архитектуре Polka Social.",
  path: "/blog",
});

export default function BlogPage() {
  return (
    <>
      <PageHeader
        eyebrow="Блог"
        title="Инженерные заметки о продукте"
        description="Короткие материалы о том, как мы проектируем публикации, согласование и AI без ложных статусов."
      />
      <Container className="grid gap-5 pb-20 md:grid-cols-2">
        {blogPosts.map((post) => (
          <Card key={post.slug}>
            <p className="text-sm text-ink/50">{post.date}</p>
            <h2 className="mt-3 text-2xl font-black text-ink">{post.title}</h2>
            <p className="mt-3 leading-7 text-ink/70">{post.excerpt}</p>
            <Link href={`/blog/${post.slug}`} className="mt-5 inline-flex font-semibold text-brand-dark">
              Читать статью
            </Link>
          </Card>
        ))}
      </Container>
    </>
  );
}
