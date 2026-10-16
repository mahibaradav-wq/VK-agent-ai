import { ArrowRight, CalendarDays, CheckCircle2 } from "lucide-react";

import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";

export function Hero() {
  return (
    <section className="overflow-hidden py-20 sm:py-28">
      <Container className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <Badge>Соцсети без хаоса</Badge>
          <h1 className="mt-6 max-w-4xl text-5xl font-black tracking-[-0.06em] text-ink sm:text-7xl">
            Планируйте, согласовывайте и публикуйте контент из одного SaaS-кабинета
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-ink/70">
            Polka Social объединяет контент-календарь, AI-помощника, медиатеку,
            согласования, безопасные интеграции и аналитику. На этапе 2 доступен
            публичный сайт и дизайн-система, без ложных заявлений о готовых API.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/register">
              Начать настройку <ArrowRight className="ml-2 size-4" />
            </ButtonLink>
            <ButtonLink href="/features" variant="secondary">
              Смотреть возможности
            </ButtonLink>
          </div>
        </div>
        <Card className="relative overflow-hidden bg-ink text-white">
          <div className="absolute right-0 top-0 size-48 rounded-full bg-brand/40 blur-3xl" />
          <div className="relative">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white/60">Календарь</p>
                <h2 className="text-2xl font-bold">Неделя публикаций</h2>
              </div>
              <CalendarDays className="size-8 text-brand-light" />
            </div>
            <div className="mt-8 grid gap-3">
              {[
                ["Пн", "AI-черновик для VK", "pending_approval"],
                ["Ср", "Карусель с подборкой товаров", "scheduled"],
                ["Пт", "Пост с аналитикой недели", "draft"],
              ].map(([day, title, status]) => (
                <div key={title} className="rounded-2xl bg-white/10 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-brand-light">{day}</p>
                      <p className="mt-1 font-semibold">{title}</p>
                    </div>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">{status}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 flex items-center gap-2 text-sm text-white/70">
              <CheckCircle2 className="size-4 text-brand-light" />
              Approval обязателен перед публикацией
            </div>
          </div>
        </Card>
      </Container>
    </section>
  );
}
