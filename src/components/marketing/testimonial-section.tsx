import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";

const principles = [
  {
    title: "Без фиктивных статусов",
    text: "Публикация не становится успешной, пока адаптер не подтвердил результат официального API.",
  },
  {
    title: "Без вымышленных отзывов",
    text: "На этом этапе мы не публикуем чужие цитаты. Раздел описывает принципы продукта, а не выдуманных клиентов.",
  },
  {
    title: "Без скрытой магии",
    text: "Если интеграция, почта или оплата не настроены, интерфейс показывает статус настройки, а не имитацию успеха.",
  },
];

export function TestimonialSection() {
  return (
    <section className="py-20">
      <Container>
        <div className="max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark">Принципы</p>
          <h2 className="mt-3 text-4xl font-black tracking-[-0.04em] text-ink sm:text-5xl">
            Как мы говорим о продукте
          </h2>
          <p className="mt-4 text-lg leading-8 text-ink/70">
            Этот блок заменяет типичные отзывы. Мы не используем вымышленные кейсы
            и не обещаем функции, которые ещё не подключены.
          </p>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {principles.map((item) => (
            <Card key={item.title}>
              <h3 className="text-xl font-bold text-ink">{item.title}</h3>
              <p className="mt-3 leading-7 text-ink/70">{item.text}</p>
            </Card>
          ))}
        </div>
      </Container>
    </section>
  );
}
