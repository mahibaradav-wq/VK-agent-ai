import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { countAutomatedDevMail, listDevMail, storeDevMail } from "@/server/mail/dev-mailbox";
import { prisma } from "@/server/db/prisma";

describe("dev mailbox listing", () => {
  const human = `human.${Date.now()}@polka.test`;
  const automated = `e2e.hide.${Date.now()}@example.test`;

  beforeAll(async () => {
    await prisma.$connect();
    await storeDevMail({
      to: automated,
      subject: "Тест",
      body: "Автопроверка",
      kind: "verify_email",
      url: "/verify-email?token=automated",
    });
    await storeDevMail({
      to: human,
      subject: "Ваше письмо",
      body: "Настоящий адрес",
      kind: "verify_email",
      url: "/verify-email?token=human",
    });
  });

  afterAll(async () => {
    await prisma.devMailMessage.deleteMany({ where: { to: { in: [human, automated] } } });
    await prisma.$disconnect();
  });

  it("hides @example.test unless includeAutomated is set", async () => {
    const visible = await listDevMail();
    const all = await listDevMail({ includeAutomated: true });
    const hidden = await countAutomatedDevMail();

    expect(visible.some((message) => message.to === human)).toBe(true);
    expect(visible.some((message) => message.to === automated)).toBe(false);
    expect(all.some((message) => message.to === automated)).toBe(true);
    expect(hidden).toBeGreaterThan(0);
  });
});
