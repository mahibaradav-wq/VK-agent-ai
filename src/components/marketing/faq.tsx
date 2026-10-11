import { Container } from "@/components/ui/container";
import { faqs } from "@/lib/site-data";

export function FAQ() {
  return (
    <section id="faq" className="py-20">
      <Container className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark">FAQ</p>
          <h2 className="mt-3 text-4xl font-black tracking-[-0.04em] text-ink sm:text-5xl">
            Ответы без обещаний недоступных функций
          </h2>
        </div>
        <div className="grid gap-4">
          {faqs.map((item) => (
            <details key={item.question} className="rounded-3xl bg-white/80 p-5 shadow-soft ring-1 ring-ink/10">
              <summary className="cursor-pointer list-none text-lg font-bold text-ink">{item.question}</summary>
              <p className="mt-3 leading-7 text-ink/70">{item.answer}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
