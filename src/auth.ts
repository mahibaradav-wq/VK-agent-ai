import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authConfig } from "@/auth.config";
import {
  loadUserSessionVersion,
  resolveSessionToken,
  stampTokenSessionVersion,
} from "@/modules/auth/session-token";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "");
        const password = String(credentials?.password ?? "");
        const [{ prisma }, { createAuthService }] = await Promise.all([
          import("@/server/db/prisma"),
          import("@/modules/auth/auth-service"),
        ]);
        const result = await createAuthService(
          prisma,
          process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
        ).authenticate(email, password);

        if (!result.ok) {
          return null;
        }

        return result.user;
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user?.id) {
        return stampTokenSessionVersion(token, {
          id: user.id,
          sessionVersion: (user as { sessionVersion?: unknown }).sessionVersion,
        });
      }
      if (!token.sub) {
        return token;
      }
      // Node runtime (RSC/actions/API): reject JWT after password reset / missing user.
      // Edge middleware uses /api/auth/session-check with the same resolveSessionToken rule.
      const { prisma } = await import("@/server/db/prisma");
      const current = await loadUserSessionVersion(token.sub, (id) =>
        prisma.user.findUnique({ where: { id }, select: { sessionVersion: true } }),
      );
      return resolveSessionToken(token, current);
    },
  },
});
