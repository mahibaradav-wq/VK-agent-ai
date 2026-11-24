import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createAuthService } from "@/modules/auth/auth-service";
import { createCollaborationService } from "@/modules/collaboration/collaboration-service";
import { createPostService } from "@/modules/posts/post-service";
import { createProductService } from "@/modules/products/product-service";
import { createProjectService } from "@/modules/projects/project-service";
import { createWorkspaceService } from "@/modules/workspaces/workspace-service";
import { prisma } from "@/server/db/prisma";

const siteUrl = "http://localhost:3000";
const auth = createAuthService(prisma, siteUrl);
const workspaces = createWorkspaceService(prisma);
const projects = createProjectService(prisma);
const posts = createPostService(prisma);
const products = createProductService(prisma);
const collab = createCollaborationService(prisma);

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

  return {
    address,
    userId: user.id,
    workspaceId: user.memberships[0]?.workspaceId ?? "",
  };
}

async function expectAccess(promise: Promise<unknown>, status: 403 | 404, message: RegExp) {
  const error = await promise.then(
    () => {
      throw new Error("expected AccessError");
    },
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(AccessError);
  expect(error).toMatchObject({
    status,
    message: expect.stringMatching(message),
  });
}

describe("workspace and project isolation", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("hides a foreign workspace and rejects spoofed project ids", async () => {
    const ownerA = await registerOwner("iso-a");
    const ownerB = await registerOwner("iso-b");
    const projectA = await projects.create(ownerA.userId, ownerA.workspaceId, { name: "Витрина A" });
    await projects.create(ownerB.userId, ownerB.workspaceId, { name: "Витрина B" });

    const visible = await workspaces.listForUser(ownerB.userId);
    expect(visible.map((item) => item.workspaceId)).toEqual([ownerB.workspaceId]);

    await expectAccess(projects.list(ownerB.userId, ownerA.workspaceId), 404, /не найдено/);
    await expectAccess(projects.get(ownerB.userId, ownerA.workspaceId, projectA.id), 404, /не найдено/);
    await expectAccess(
      projects.get(ownerB.userId, ownerB.workspaceId, projectA.id),
      403,
      /другому рабочему пространству/,
    );
    await expectAccess(
      projects.update(ownerB.userId, ownerB.workspaceId, projectA.id, { name: "Подмена" }),
      403,
      /другому рабочему пространству/,
    );
  });

  it("stops a Viewer from creating a project or elevating a role", async () => {
    const owner = await registerOwner("iso-owner");
    const viewer = await registerOwner("iso-viewer");
    await workspaces.addMember(owner.userId, owner.workspaceId, viewer.address, "Viewer");

    await expectAccess(
      projects.create(viewer.userId, owner.workspaceId, { name: "Чужой проект" }),
      403,
      /Недостаточно прав/,
    );
    await expectAccess(
      workspaces.changeRole(viewer.userId, owner.workspaceId, viewer.userId, "Owner"),
      403,
      /Недостаточно прав/,
    );
    await expectAccess(
      workspaces.changeRole(owner.userId, owner.workspaceId, owner.userId, "Owner"),
      403,
      /собственную роль/,
    );
  });

  it("does not let Admin assign Owner or change an equal Admin", async () => {
    const owner = await registerOwner("iso-admin-owner");
    const admin = await registerOwner("iso-admin");
    const peer = await registerOwner("iso-admin-peer");
    await workspaces.addMember(owner.userId, owner.workspaceId, admin.address, "Admin");
    await workspaces.addMember(owner.userId, owner.workspaceId, peer.address, "Admin");

    await expectAccess(
      workspaces.addMember(admin.userId, owner.workspaceId, email("iso-new"), "Owner"),
      403,
      /не ниже собственной/,
    );
    await expectAccess(
      workspaces.changeRole(admin.userId, owner.workspaceId, admin.userId, "Owner"),
      403,
      /собственную роль/,
    );
    await expectAccess(
      workspaces.changeRole(admin.userId, owner.workspaceId, peer.userId, "Editor"),
      403,
      /равной или более высокой/,
    );
  });

  it("rejects spoofed post, product, and notification ids from another workspace or user", async () => {
    const ownerA = await registerOwner("iso-idor-a");
    const ownerB = await registerOwner("iso-idor-b");
    const projectA = await projects.create(ownerA.userId, ownerA.workspaceId, { name: "Проект A" });
    const postA = await posts.create(ownerA.userId, ownerA.workspaceId, projectA.id, "Черновик A");
    const productA = await prisma.shopProduct.create({
      data: {
        workspaceId: ownerA.workspaceId,
        projectId: projectA.id,
        shop: "ozon",
        sourceUrl: "https://www.ozon.ru/product/polka-111/",
        canonicalUrl: "https://www.ozon.ru/product/polka-111/",
        title: "Полка",
        priceText: "100 ₽",
      },
    });
    const noteA = await prisma.notification.create({
      data: {
        workspaceId: ownerA.workspaceId,
        userId: ownerA.userId,
        type: "publish_job",
        title: "Готово",
        body: "Проверка IDOR",
        entityType: "publish_job",
        entityId: "job-a",
      },
    });

    await expectAccess(posts.get(ownerB.userId, ownerB.workspaceId, postA.id), 403, /другому рабочему пространству/);
    await expectAccess(posts.get(ownerB.userId, ownerA.workspaceId, postA.id), 404, /не найдено/);
    await expectAccess(
      products.refresh(ownerB.userId, ownerB.workspaceId, projectA.id, productA.id),
      403,
      /другому рабочему пространству/,
    );
    await expectAccess(collab.addComment(ownerB.userId, ownerB.workspaceId, postA.id, "чужой"), 403, /другому рабочему пространству/);
    await expectAccess(collab.markRead(ownerB.userId, ownerB.workspaceId, noteA.id), 403, /другому рабочему пространству/);
    await expectAccess(collab.markRead(ownerB.userId, ownerA.workspaceId, noteA.id), 404, /не найдено/);

    await workspaces.addMember(ownerA.userId, ownerA.workspaceId, ownerB.address, "Editor");
    await expectAccess(collab.markRead(ownerB.userId, ownerA.workspaceId, noteA.id), 403, /чужое уведомление/);
    expect(await prisma.notification.findUniqueOrThrow({ where: { id: noteA.id } })).toMatchObject({ readAt: null });
  });
});
