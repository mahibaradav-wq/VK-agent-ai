import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAuthService } from "@/modules/auth/auth-service";
import { createAiService } from "@/modules/ai/ai-service";
import { createPostService } from "@/modules/posts/post-service";
import { createProductService } from "@/modules/products/product-service";
import { createWatchService } from "@/modules/watch/watch-service";
import {
  STARTER_PROJECT_NAME,
  createProjectService,
  createStarterProjectIfMissing,
} from "@/modules/projects/project-service";
import { prisma } from "@/server/db/prisma";

const auth = createAuthService(prisma, "http://localhost:3000");
const projects = createProjectService(prisma);
const posts = createPostService(prisma);
const ai = createAiService(prisma);
const products = createProductService(prisma);
const watch = createWatchService(prisma);

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

  it("rejects opening and updating an archived project", async () => {
    const address = email("archived-project");
    await auth.register(address, "password123");
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: address },
      include: { memberships: true },
    });
    const workspaceId = user.memberships[0]?.workspaceId ?? "";
    const project = await projects.create(user.id, workspaceId, { name: "Архивный тест" });
    await projects.archive(user.id, workspaceId, project.id);

    await expect(projects.get(user.id, workspaceId, project.id)).rejects.toMatchObject({
      status: 409,
      message: "Архивный проект нельзя открыть или изменить. Выберите активный проект.",
    });
    await expect(projects.update(user.id, workspaceId, project.id, { name: "Изменённый" })).rejects.toMatchObject({
      status: 409,
    });
    expect(await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).toMatchObject({
      archivedAt: expect.any(Date),
      name: "Архивный тест",
    });
  });


  it("blocks direct post, AI, VK Watch, and product actions for archived projects", async () => {
    const address = email("archived-service-guard");
    await auth.register(address, "password123");
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: address },
      include: { memberships: true },
    });
    const workspaceId = user.memberships[0]?.workspaceId ?? "";
    const project = await projects.create(user.id, workspaceId, { name: "Проект для проверки" });
    const post = await posts.create(user.id, workspaceId, project.id, "Черновик");

    await projects.archive(user.id, workspaceId, project.id);

    await expect(posts.get(user.id, workspaceId, post.id)).rejects.toMatchObject({ status: 409 });
    await expect(posts.list(user.id, workspaceId, project.id)).rejects.toMatchObject({ status: 409 });
    await expect(posts.create(user.id, workspaceId, project.id, "Новый черновик")).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      ai.generate(user.id, workspaceId, {
        kind: "ideas",
        prompt: "Проверка блокировки архивного проекта",
        projectId: project.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(watch.collectIdeas(user.id, workspaceId, { projectId: project.id })).rejects.toMatchObject({
      status: 409,
    });
    await expect(watch.listIdeas(user.id, workspaceId, project.id)).rejects.toMatchObject({ status: 409 });
    await expect(products.list(user.id, workspaceId, project.id)).rejects.toMatchObject({ status: 409 });
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
