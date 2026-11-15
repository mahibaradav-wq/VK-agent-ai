import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAuthService } from "@/modules/auth/auth-service";
import { createProductService } from "@/modules/products/product-service";
import { createProjectService } from "@/modules/projects/project-service";
import { prisma } from "@/server/db/prisma";

const auth = createAuthService(prisma, "http://localhost:3000");
const projects = createProjectService(prisma);
const products = createProductService(prisma);

function email(label: string) {
  return `${label}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;
}

describe("shop products", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps products per project, consumes into studio, and isolates workspaces", async () => {
    const address = email("goods");
    await auth.register(address, "password123");
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: address },
      include: { memberships: true },
    });
    const workspaceId = user.memberships[0]?.workspaceId ?? "";
    const projectA = await projects.create(user.id, workspaceId, { name: "Клуб А" });
    const projectB = await projects.create(user.id, workspaceId, { name: "Клуб Б" });

    const added = await products.addFromUrl(
      user.id,
      workspaceId,
      projectA.id,
      "https://www.ozon.ru/product/organayzer-dlya-kuhni-555/",
    );
    expect(added.shop).toBe("ozon");
    expect((await products.list(user.id, workspaceId, projectA.id)).map((item) => item.id)).toEqual([added.id]);
    expect(await products.list(user.id, workspaceId, projectB.id)).toEqual([]);

    const other = email("goods-other");
    await auth.register(other, "password123");
    const stranger = await prisma.user.findUniqueOrThrow({
      where: { email: other },
      include: { memberships: true },
    });
    const otherWorkspace = stranger.memberships[0]?.workspaceId ?? "";
    await expect(products.list(stranger.id, otherWorkspace, projectA.id)).rejects.toMatchObject({ status: 403 });

    await products.consume(user.id, workspaceId, projectA.id, added.id);
    expect(await products.list(user.id, workspaceId, projectA.id)).toEqual([]);
  });
});
