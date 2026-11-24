import type { Prisma, PrismaClient } from "@prisma/client";

const accountInclude = { capabilities: true } satisfies Prisma.SocialAccountInclude;

export async function resolvePublishSocialAccount(
  db: PrismaClient,
  input: { targetId: string; workspaceId: string },
  platform: "telegram" | "vk",
) {
  const target = await db.postTarget.findUnique({
    where: { id: input.targetId },
    include: {
      socialAccount: { include: accountInclude },
      post: { select: { projectId: true, workspaceId: true } },
    },
  });

  if (!target || target.workspaceId !== input.workspaceId || !target.post || target.post.workspaceId !== input.workspaceId) {
    return null;
  }

  const projectId = target.post.projectId;
  const bound = target.socialAccount;
  // Only a connection of THIS project. A workspace-global token (projectId=null)
  // is not an implicit fallback and is not used even if already bound on the target.
  if (
    bound &&
    bound.workspaceId === input.workspaceId &&
    bound.platform === platform &&
    bound.status === "connected" &&
    bound.projectId === projectId
  ) {
    return bound;
  }

  return db.socialAccount.findFirst({
    where: {
      workspaceId: input.workspaceId,
      platform,
      status: "connected",
      projectId,
    },
    include: accountInclude,
    orderBy: { updatedAt: "desc" },
  });
}
