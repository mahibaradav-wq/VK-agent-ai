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

  // Bound target wins if it is this workspace and either global or this project.
  // Otherwise use a project-specific account; a workspace-global token is only
  // the default when the project has no own connection. Never use another project's account.
  const bound = target.socialAccount;
  const projectId = target.post.projectId;
  if (
    bound &&
    bound.workspaceId === input.workspaceId &&
    bound.platform === platform &&
    bound.status === "connected" &&
    (!bound.projectId || bound.projectId === projectId)
  ) {
    return bound;
  }

  const projectAccount = await db.socialAccount.findFirst({
    where: {
      workspaceId: input.workspaceId,
      platform,
      status: "connected",
      projectId,
    },
    include: accountInclude,
    orderBy: { updatedAt: "desc" },
  });
  if (projectAccount) {
    return projectAccount;
  }

  return db.socialAccount.findFirst({
    where: {
      workspaceId: input.workspaceId,
      platform,
      status: "connected",
      projectId: null,
    },
    include: accountInclude,
    orderBy: { updatedAt: "desc" },
  });
}
