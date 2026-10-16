import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createAuthService } from "@/modules/auth/auth-service";
import { createProjectService } from "@/modules/projects/project-service";
import { createWorkspaceService } from "@/modules/workspaces/workspace-service";
import { prisma } from "@/server/db/prisma";

const siteUrl = "http://localhost:3000";
const auth = createAuthService(prisma, siteUrl);
const workspaces = createWorkspaceService(prisma);
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
});
