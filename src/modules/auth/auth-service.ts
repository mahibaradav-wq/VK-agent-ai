import { createHash, randomBytes } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import { attachFreeSubscription, ensureCanonicalPlans } from "@/modules/billing/plans";
import { createStarterProjectIfMissing } from "@/modules/projects/project-service";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_TTL_MS = 1000 * 60 * 60;

export type AuthServiceResult =
  | { ok: true; message: string; mailboxUrl?: string; email?: string }
  | { ok: false; message: string; email?: string };

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function isValidEmail(email: string) {
  return EMAIL_RE.test(email);
}

export function createAuthService(db: PrismaClient, _siteUrl: string) {
  async function writeAudit(action: string, entityId: string, actorId?: string, details?: string) {
    await db.auditLog.create({
      data: {
        action,
        entityType: "user",
        entityId,
        actorId,
        details,
      },
    });
  }

  return {
    async register(email: string, password: string): Promise<AuthServiceResult> {
      const normalizedEmail = email.trim().toLowerCase();

      if (!isValidEmail(normalizedEmail) || password.length < 8) {
        return { ok: false, message: "Проверьте email и пароль. Пароль должен содержать минимум 8 символов." };
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const token = randomBytes(32).toString("hex");
      const workspaceName = `Рабочее пространство ${normalizedEmail.split("@")[0]}`;

      try {
        await ensureCanonicalPlans(db);
        const user = await db.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: {
              email: normalizedEmail,
              passwordHash,
              memberships: {
                create: {
                  role: "Owner",
                  workspace: {
                    create: { name: workspaceName },
                  },
                },
              },
            },
            include: { memberships: true },
          });
          const workspaceId = created.memberships[0]?.workspaceId;
          if (workspaceId) {
            await attachFreeSubscription(tx, workspaceId);
            await createStarterProjectIfMissing(tx, workspaceId, created.id);
          }

          await tx.verificationToken.create({
            data: {
              identifier: normalizedEmail,
              token: hashToken(token),
              expires: new Date(Date.now() + TOKEN_TTL_MS),
            },
          });

          await tx.devMailMessage.create({
            data: {
              to: normalizedEmail,
              subject: "Подтверждение email",
              body: "Откройте ссылку из локального почтового стенда, чтобы подтвердить адрес.",
              url: `/verify-email?token=${token}`,
              kind: "verify_email",
            },
          });

          return created;
        });

        await writeAudit("REGISTER", user.id, user.id, normalizedEmail);

        return {
          ok: true,
          message:
            "Аккаунт создан. Письмо не отправлялось во внешнюю почту. Ссылка подтверждения лежит в локальном почтовом стенде.",
          mailboxUrl: "/dev/mailbox",
        };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return { ok: false, message: "Этот email уже занят." };
        }
        throw error;
      }
    },

    async findMailboxUser(token: string) {
      if (!token) {
        return null;
      }
      const mail = await db.devMailMessage.findFirst({
        where: { kind: "verify_email", url: { contains: token } },
        orderBy: { createdAt: "desc" },
      });
      if (!mail) {
        return null;
      }
      return db.user.findUnique({ where: { email: mail.to } });
    },

    async inspectEmailToken(token: string) {
      if (!token) {
        return { status: "missing" as const, message: "Токен подтверждения отсутствует." };
      }
      const record = await db.verificationToken.findUnique({
        where: { token: hashToken(token) },
      });
      if (record && record.expires >= new Date()) {
        return {
          status: "pending" as const,
          email: record.identifier,
          message: "Нажмите кнопку ниже, чтобы подтвердить email и открыть вход.",
        };
      }
      const known = await this.findMailboxUser(token);
      if (known?.emailVerified) {
        return {
          status: "already" as const,
          email: known.email,
          message: "Email уже подтверждён. Войдите в кабинет.",
        };
      }
      if (record && record.expires < new Date()) {
        return {
          status: "expired" as const,
          email: record.identifier,
          message: "Ссылка устарела. Запросите новое письмо подтверждения.",
        };
      }
      return {
        status: "invalid" as const,
        email: known?.email,
        message: "Токен подтверждения недействителен или уже использован. Если почтовый стенд только что открывался, войдите — адрес мог подтвердиться заранее.",
      };
    },

    async verifyEmail(token: string): Promise<AuthServiceResult> {
      const inspected = await this.inspectEmailToken(token);
      if (inspected.status === "already" && inspected.email) {
        return { ok: true, message: inspected.message, email: inspected.email };
      }
      if (inspected.status !== "pending" || !inspected.email) {
        return { ok: false, message: inspected.message, ...(inspected.email ? { email: inspected.email } : {}) };
      }

      const record = await db.verificationToken.findUnique({
        where: { token: hashToken(token) },
      });
      if (!record || record.expires < new Date()) {
        return { ok: false, message: "Токен подтверждения недействителен или просрочен." };
      }

      const user = await db.user.update({
        where: { email: record.identifier },
        data: { emailVerified: new Date() },
      });

      await db.verificationToken.delete({
        where: { identifier_token: { identifier: record.identifier, token: record.token } },
      });
      await writeAudit("VERIFY_EMAIL", user.id, user.id);

      return { ok: true, message: "Email подтверждён. Войдите в кабинет.", email: user.email };
    },

    async resendVerification(email: string): Promise<AuthServiceResult> {
      const normalizedEmail = email.trim().toLowerCase();
      if (!isValidEmail(normalizedEmail)) {
        return { ok: false, message: "Укажите корректный email." };
      }
      const user = await db.user.findUnique({ where: { email: normalizedEmail } });
      if (!user) {
        return {
          ok: true,
          message: "Если аккаунт существует, новое письмо появится в локальном почтовом стенде.",
          mailboxUrl: "/dev/mailbox",
        };
      }
      if (user.emailVerified) {
        return { ok: true, message: "Email уже подтверждён. Войдите в кабинет.", email: user.email };
      }
      const token = randomBytes(32).toString("hex");
      await db.$transaction([
        db.verificationToken.deleteMany({ where: { identifier: normalizedEmail } }),
        db.verificationToken.create({
          data: {
            identifier: normalizedEmail,
            token: hashToken(token),
            expires: new Date(Date.now() + TOKEN_TTL_MS),
          },
        }),
        db.devMailMessage.create({
          data: {
            to: normalizedEmail,
            subject: "Подтверждение email",
            body: "Откройте ссылку из локального почтового стенда, чтобы подтвердить адрес.",
            url: `/verify-email?token=${token}`,
            kind: "verify_email",
          },
        }),
      ]);
      return {
        ok: true,
        message: "Новое письмо подтверждения лежит в локальном почтовом стенде.",
        mailboxUrl: "/dev/mailbox",
        email: normalizedEmail,
      };
    },

    async requestPasswordReset(email: string): Promise<AuthServiceResult> {
      const normalizedEmail = email.trim().toLowerCase();

      if (!isValidEmail(normalizedEmail)) {
        return { ok: false, message: "Укажите корректный email." };
      }

      const user = await db.user.findUnique({ where: { email: normalizedEmail } });

      if (user) {
        const token = randomBytes(32).toString("hex");
        await db.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: hashToken(token),
            expires: new Date(Date.now() + TOKEN_TTL_MS),
          },
        });
        await db.devMailMessage.create({
          data: {
            to: normalizedEmail,
            subject: "Сброс пароля",
            body: "Откройте ссылку из локального почтового стенда, чтобы задать новый пароль.",
            url: `/reset-password?token=${token}`,
            kind: "reset_password",
          },
        });
        await writeAudit("REQUEST_PASSWORD_RESET", user.id, user.id);
      }

      return {
        ok: true,
        message:
          "Письмо не отправлялось во внешнюю почту. Если аккаунт существует, ссылка появилась в локальном почтовом стенде.",
        mailboxUrl: "/dev/mailbox",
      };
    },

    async resetPassword(token: string, password: string): Promise<AuthServiceResult> {
      if (!token || password.length < 8) {
        return { ok: false, message: "Проверьте токен и пароль. Пароль должен содержать минимум 8 символов." };
      }

      const record = await db.passwordResetToken.findUnique({
        where: { tokenHash: hashToken(token) },
      });

      if (!record || record.expires < new Date()) {
        return { ok: false, message: "Токен сброса пароля недействителен или просрочен." };
      }

      const passwordHash = await bcrypt.hash(password, 12);
      await db.$transaction([
        db.user.update({
          where: { id: record.userId },
          data: { passwordHash },
        }),
        db.passwordResetToken.deleteMany({
          where: { userId: record.userId },
        }),
      ]);
      await writeAudit("RESET_PASSWORD", record.userId, record.userId);

      return { ok: true, message: "Пароль обновлён. Войдите с новым паролем." };
    },

    async authenticate(email: string, password: string) {
      const normalizedEmail = email.trim().toLowerCase();
      const user = await db.user.findUnique({
        where: { email: normalizedEmail },
        include: { memberships: true },
      });

      if (!user) {
        return { ok: false as const, message: "Неверный email или пароль." };
      }

      const matches = await bcrypt.compare(password, user.passwordHash);
      if (!matches) {
        return { ok: false as const, message: "Неверный email или пароль." };
      }

      if (!user.emailVerified) {
        return { ok: false as const, message: "Сначала подтвердите email через локальный почтовый стенд." };
      }

      return {
        ok: true as const,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      };
    },
  };
}
