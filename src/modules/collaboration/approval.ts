import type { PrismaClient } from "@prisma/client";

import { AccessError } from "@/modules/access/permissions";

export const APPROVED_STATUS = "approved";
export const REJECTED_STATUS = "rejected";
export const INVALIDATED_STATUS = "invalidated";

export async function findActiveApproval(
  db: Pick<PrismaClient, "approval">,
  postId: string,
  postVersionId: string,
) {
  return db.approval.findFirst({
    where: { postId, postVersionId, status: APPROVED_STATUS },
    orderBy: { createdAt: "desc" },
  });
}

export async function assertApprovedVersion(
  db: Pick<PrismaClient, "approval">,
  post: { id: string; versions: Array<{ id: string; supersededAt: Date | null }> },
) {
  const version = post.versions.find((item) => !item.supersededAt) ?? post.versions[0] ?? null;
  if (!version) {
    throw new AccessError(400, "У публикации нет версии для отправки.");
  }
  const approval = await findActiveApproval(db, post.id, version.id);
  if (!approval) {
    throw new AccessError(403, "Нужно согласование текущей версии.");
  }
  return approval;
}

export async function invalidateApprovals(tx: { approval: Pick<PrismaClient["approval"], "updateMany"> }, postId: string) {
  await tx.approval.updateMany({
    where: { postId, status: APPROVED_STATUS },
    data: { status: INVALIDATED_STATUS },
  });
}
