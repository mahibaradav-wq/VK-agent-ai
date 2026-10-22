import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { pricingPlans } from "@/lib/site-data";

export function PricingTable() {
  return (
    <section id="pricing" className="py-20">
      <Container>
        <div className="max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark">Тарифы</p>
          <h2 className="mt-3 text-4xl font-black tracking-[-0.04em] text-ink sm:text-5xl">
            Лимиты и цены хранятся отдельно от интерфейса
          </h2>
          <p className="mt-4 text-lg leading-8 text-ink/70">
            Платежи не имитируются. Если провайдер не настроен, пользователь видит
            статус настройки, а не ложную оплату.
          </p>
        </div>
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {pricingPlans.map((plan) => (
            <Card key={plan.name} className={plan.highlighted ? "bg-ink text-white" : undefined}>
              <p className={plan.highlighted ? "text-white/70" : "text-ink/60"}>{plan.name}</p>
              <p className="mt-3 text-3xl font-black">{plan.price}</p>
              <p className={`mt-3 leading-7 ${plan.highlighted ? "text-white/70" : "text-ink/70"}`}>
                {plan.description}
              </p>
              <ul className="mt-6 grid gap-2 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <ButtonLink
                href="/register"
                variant={plan.highlighted ? "secondary" : "primary"}
                className="mt-8 w-full"
              >
                Выбрать {plan.name}
              </ButtonLink>
            </Card>
          ))}
        </div>
      </Container>
    </section>
  );
}
