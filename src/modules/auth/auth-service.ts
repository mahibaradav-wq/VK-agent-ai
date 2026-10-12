import { createHash, randomBytes } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_TTL_MS = 1000 * 60 * 60;

export type AuthServiceResult =
  | { ok: true; message: string; mailboxUrl?: string }
  | { ok: false; message: string };

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function isValidEmail(email: string) {
  return EMAIL_RE.test(email);
}

export function createAuthService(db: PrismaClient, siteUrl: string) {
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
          });

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
              url: `${siteUrl}/verify-email?token=${token}`,
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

    async verifyEmail(token: string): Promise<AuthServiceResult> {
      if (!token) {
        return { ok: false, message: "Токен подтверждения отсутствует." };
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

      return { ok: true, message: "Email подтверждён. Теперь можно войти." };
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
            url: `${siteUrl}/reset-password?token=${token}`,
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
