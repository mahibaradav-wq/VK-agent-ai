import { BarChart3, Bot, CalendarClock, ImageIcon, UsersRound } from "lucide-react";

import { CTASection } from "@/components/marketing/cta-section";
import { FAQ } from "@/components/marketing/faq";
import { FeatureSection } from "@/components/marketing/feature-section";
import { Hero } from "@/components/marketing/hero";
import { PricingTable } from "@/components/marketing/pricing-table";
import { ProductBlock } from "@/components/marketing/product-block";
import { TestimonialSection } from "@/components/marketing/testimonial-section";
import { createPageMetadata } from "@/lib/metadata";
import { homeHighlights } from "@/lib/site-data";

export const metadata = createPageMetadata({
  title: "Планирование и согласование публикаций",
  description:
    "Публичный сайт Polka Social: календарь, AI-подготовка, медиатека, approval и безопасные интеграции без фиктивных статусов.",
  path: "/",
});

export default function HomePage() {
  return (
    <>
      <Hero />
      <FeatureSection
        eyebrow="Преимущества"
        title="Одна рабочая цепочка вместо набора разрозненных сервисов"
        description="Платформа проектируется как полноценный SaaS: от идеи и согласования до очереди публикаций и журнала попыток."
        items={homeHighlights}
      />
      <ProductBlock
        eyebrow="Планирование"
        title="Календарь публикаций, а не таблица статусов"
        description="Месяц, неделя, день и список. Фильтры по проектам, аккаунтам и статусам появятся вместе с реальными записями из PostgreSQL."
        points={["черновики и материалы на согласовании", "даты в UTC", "ошибки очереди видны сразу"]}
        href="/features/autoposting"
        cta="Как устроен автопостинг"
        icon={CalendarClock}
      />
      <ProductBlock
        eyebrow="AI-инструменты"
        title="Ассистент готовит текст, команда принимает решение"
        description="Генерация идей, заголовков, CTA и адаптаций идёт через серверный адаптер. Публикация без approval недоступна."
        points={["история генераций", "перенос в редактор", "лимиты по тарифу"]}
        href="/features/ai-assistant"
        cta="Подробнее про AI"
        icon={Bot}
      />
      <ProductBlock
        eyebrow="Аналитика"
        title="Метрики с источником и временем обновления"
        description="Нормализованный слой аналитики сохраняет платформу, период и исходный payload. Вымышленные охваты в рабочем режиме не используются."
        points={["успешные и неуспешные публикации", "фильтры по проектам", "явная маркировка демо-данных"]}
        href="/features/analytics"
        cta="Как считается аналитика"
        icon={BarChart3}
      />
      <ProductBlock
        eyebrow="Медиастудия"
        title="Файлы в объектном хранилище"
        description="Медиатека проверяет тип и размер файла, создаёт миниатюры и позволяет повторно использовать материалы в публикациях."
        points={["S3-compatible storage", "поиск и папки", "привязка к постам"]}
        href="/features/media-library"
        cta="Открыть медиатеку"
        icon={ImageIcon}
      />
      <ProductBlock
        eyebrow="Команда"
        title="Роли, комментарии и согласование"
        description="Owner, Admin, Editor, Approver и Viewer работают в одном workspace. Права проверяются на сервере."
        points={["приглашения по email", "доступ к проектам", "история изменений"]}
        href="/features/team"
        cta="Командная работа"
        icon={UsersRound}
      />
      <PricingTable />
      <FAQ />
      <TestimonialSection />
      <CTASection />
    </>
  );
}
