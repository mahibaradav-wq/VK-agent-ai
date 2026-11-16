import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAiBalanceService } from "@/modules/ai/balance-service";
import { createAuthService } from "@/modules/auth/auth-service";
import { createProjectService } from "@/modules/projects/project-service";
import { encryptToken } from "@/server/crypto/token-cipher";
import { prisma } from "@/server/db/prisma";

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
  const workspaceId = user.memberships[0]?.workspaceId ?? "";
  await projects.create(user.id, workspaceId, { name: `Проект ${label}` });
  return { userId: user.id, workspaceId };
}

describe("ChatGPT balance pin", () => {
  const previousKey = process.env.TOKEN_ENCRYPTION_KEY;

  beforeAll(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "ai-balance-tests";
    await prisma.$connect();
  });

  afterAll(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = previousKey;
    await prisma.$disconnect();
  });

  it("says there is no key instead of inventing a balance", async () => {
    const owner = await registerOwner("bal-empty");
    const balance = await createAiBalanceService(prisma, { envApiKey: "" }).read(owner.userId, owner.workspaceId);
    expect(balance.hasKey).toBe(false);
    expect(balance.remainingUsd).toBeNull();
    expect(balance.label).toBe("API нет ключа");
  });

  it("pins the remaining ChatGPT dollars from a live billing read", async () => {
    const owner = await registerOwner("bal-ok");
    await prisma.workspaceAiConnection.create({
      data: {
        workspaceId: owner.workspaceId,
        provider: "openai",
        encryptedApiKey: encryptToken("sk-test-secret-key"),
        model: "gpt-4o-mini",
        imageModel: "gpt-image-1.5",
        status: "connected",
        connectedById: owner.userId,
      },
    });
    const balance = await createAiBalanceService(prisma, {
      envApiKey: "",
      fetchImpl: async () =>
        new Response(JSON.stringify({ total_available: 8.4 }), { status: 200 }),
    }).read(owner.userId, owner.workspaceId, { refresh: true });
    expect(balance.hasKey).toBe(true);
    expect(balance.remainingUsd).toBe(8.4);
    expect(balance.label).toBe("API 8,40 $");
    expect(JSON.stringify(balance)).not.toMatch(/sk-test-secret-key/);
  });
});
