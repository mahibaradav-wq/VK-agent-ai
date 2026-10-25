import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAuthService } from "@/modules/auth/auth-service";
import {
  STARTER_PROJECT_NAME,
  createProjectService,
  createStarterProjectIfMissing,
} from "@/modules/projects/project-service";
import { prisma } from "@/server/db/prisma";

const auth = createAuthService(prisma, "http://localhost:3000");
const projects = createProjectService(prisma);

function email(label: string) {
  return `${label}.${Date.now()}@example.test`;
}

describe("starter project", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates one starter project on register and does not duplicate it", async () => {
    const address = email("starter");
    await auth.register(address, "password123");
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: address },
      include: { memberships: true },
    });
    const workspaceId = user.memberships[0]?.workspaceId ?? "";
    const first = await createStarterProjectIfMissing(prisma, workspaceId, user.id);
    const second = await createStarterProjectIfMissing(prisma, workspaceId, user.id);
    const listed = await projects.list(user.id, workspaceId);

    expect(first.created).toBe(false);
    expect(second.created).toBe(false);
    expect(first.project.id).toBe(second.project.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe(STARTER_PROJECT_NAME);
  });
});
