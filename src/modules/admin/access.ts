import type { PlatformAdmin, PlatformAdminRole, PrismaClient, User } from "@prisma/client";

import { AccessError } from "@/modules/access/permissions";

export const platformAdminRoles = ["Support", "Superadmin"] as const satisfies readonly PlatformAdminRole[];

export function parseAdminEmails(raw = process.env.ADMIN_EMAILS ?? "") {
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function parsePlatformAdminRole(value: string): PlatformAdminRole {
  if ((platformAdminRoles as readonly string[]).includes(value)) {
    return value as PlatformAdminRole;
  }
  throw new AccessError(400, "Неизвестная роль платформенного администратора.");
}

export function canMutatePlatform(role: PlatformAdminRole) {
  return role === "Superadmin";
}

export async function ensureBootstrapAdmin(db: PrismaClient, user: Pick<User, "id" | "email">) {
  const emails = parseAdminEmails();
  if (!emails.includes(user.email.toLowerCase())) {
    return null;
  }
  const existing = await db.platformAdmin.findUnique({ where: { userId: user.id } });
  if (existing) {
    return existing;
  }
  const created = await db.platformAdmin.create({
    data: { userId: user.id, role: "Superadmin" },
  });
  await db.auditLog.create({
    data: {
      action: "BOOTSTRAP_PLATFORM_ADMIN",
      entityType: "platform_admin",
      entityId: created.id,
      actorId: user.id,
      details: user.email,
    },
  });
  return created;
}

export async function requirePlatformAdmin(db: PrismaClient, userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { platformAdmin: true },
  });
  if (!user) {
    throw new AccessError(404, "Пользователь не найден.");
  }
  const admin = user.platformAdmin ?? (await ensureBootstrapAdmin(db, user));
  if (!admin) {
    throw new AccessError(403, "Недостаточно прав для админки.");
  }
  return { user, admin };
}

export async function isPlatformAdmin(db: PrismaClient, userId: string) {
  try {
    await requirePlatformAdmin(db, userId);
    return true;
  } catch (error) {
    if (error instanceof AccessError && (error.status === 403 || error.status === 404)) {
      return false;
    }
    throw error;
  }
}

export type PlatformActor = {
  user: User;
  admin: PlatformAdmin;
};
