import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as getSubscription } from "@/app/api/subscription/route";
import { POST as postBillingWebhook } from "@/app/api/webhooks/billing/route";
import { AccessError } from "@/modules/access/permissions";
import { createAiConnectionService } from "@/modules/ai/provider-service";
import { createAiService } from "@/modules/ai/ai-service";
import { createAuthService } from "@/modules/auth/auth-service";
import { createBillingService } from "@/modules/billing/billing-service";
import { COMMERCIAL_BILLING_DISABLED_MESSAGE } from "@/modules/cabinet/commercial";
import { createProjectService } from "@/modules/projects/project-service";
import { prisma } from "@/server/db/prisma";
import { createHmacBillingProvider } from "@/server/billing";
import { createUnconfiguredAiProvider } from "@/server/ai/unconfigured";

const auth = createAuthService(prisma, "http://localhost:3000");
const projects = createProjectService(prisma);

function email(label: string) {
  return `${label}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;
}

async function registerOwner(label: string) {
  const address = email(label);
  const result = await auth.register(address, "password123");
  expect(result.ok).toBe(true);
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: address },
    include: { memberships: true },
  });
  return { address, userId: user.id, workspaceId: user.memberships[0]?.workspaceId ?? "" };
}

describe("personal cabinet", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects commercial checkout when billing is not explicitly enabled", async () => {
    const previous = process.env.BILLING_CHECKOUT_ENABLED;
    delete process.env.BILLING_CHECKOUT_ENABLED;
    try {
      const owner = await registerOwner("no-commerce");
      const billing = createBillingService(prisma, {
        provider: createHmacBillingProvider({ secret: "test-not-used" }),
      });
      await expect(billing.startCheckout(owner.userId, owner.workspaceId, "team")).rejects.toBeInstanceOf(AccessError);
      await expect(billing.startCheckout(owner.userId, owner.workspaceId, "team")).rejects.toMatchObject({
        status: 403,
        message: COMMERCIAL_BILLING_DISABLED_MESSAGE,
      });
      await expect(billing.handleWebhook("{}", "")).rejects.toMatchObject({
        status: 403,
        message: COMMERCIAL_BILLING_DISABLED_MESSAGE,
      });
      expect((await getSubscription()).status).toBe(403);
      expect((await postBillingWebhook()).status).toBe(403);
    } finally {
      if (previous === undefined) {
        delete process.env.BILLING_CHECKOUT_ENABLED;
      } else {
        process.env.BILLING_CHECKOUT_ENABLED = previous;
      }
    }
  });

  it("uses one OpenAI connection for every project of the owner", async () => {
    const owner = await registerOwner("one-openai");
    const second = await projects.create(owner.userId, owner.workspaceId, { name: "Второй клуб" });
    const connections = createAiConnectionService(prisma, {
      envProvider: createUnconfiguredAiProvider(),
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: [{ id: "gpt-4o-mini" }],
            model: "gpt-4o-mini",
            choices: [{ message: { content: JSON.stringify({ title: "Общий ключ", body: "Текст", items: [] }) } }],
          }),
          { status: 200 },
        ),
    });
    await connections.connect(owner.userId, owner.workspaceId, {
      provider: "openai",
      apiKey: "sk-cabinet-secret-key",
    });

    const otherWorkspace = await prisma.workspace.create({ data: { name: "Второй кабинет-клон" } });
    await prisma.workspaceMember.create({
      data: { workspaceId: otherWorkspace.id, userId: owner.userId, role: "Owner" },
    });

    const listed = await connections.listProviders(otherWorkspace.id, "copy");
    expect(listed[0]?.ready).toBe(true);
    expect(listed[0]?.name).toBe("openai");

    const ai = createAiService(prisma, { connections });
    const first = await ai.generate(owner.userId, owner.workspaceId, {
      kind: "headline",
      prompt: "полка для круп",
      projectId: second.id,
    });
    expect(first.provider).toBe("openai");
    expect(first.title).toBe("Общий ключ");
    expect(JSON.stringify(first)).not.toMatch(/sk-cabinet-secret-key/);

    const stranger = await registerOwner("other-openai");
    const strangerProviders = await connections.listProviders(stranger.workspaceId, "copy");
    expect(strangerProviders).toEqual([]);

    const gated = createAiService(prisma);
    await expect(
      gated.generate(owner.userId, owner.workspaceId, { kind: "headline", prompt: "нельзя в live" }),
    ).rejects.toMatchObject({
      status: 403,
      message: /AI_LIVE_ENABLED/,
    });
    const denial = await prisma.auditLog.findFirst({
      where: { action: "AI_PAID_DENIED", entityId: owner.workspaceId },
      orderBy: { createdAt: "desc" },
    });
    expect(denial?.details).toMatch(/AI_LIVE_ENABLED/);
    expect(JSON.stringify(denial)).not.toMatch(/sk-cabinet-secret-key/);
  });
});
