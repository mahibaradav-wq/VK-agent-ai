import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authConfig } from "@/auth.config";

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
        token.sub = user.id;
        token.sessionVersion =
          typeof (user as { sessionVersion?: unknown }).sessionVersion === "number"
            ? (user as { sessionVersion: number }).sessionVersion
            : 0;
        return token;
      }
      if (!token.sub) {
        return token;
      }
      // Node-only path (not Edge middleware): invalidate JWT after password reset.
      const { prisma } = await import("@/server/db/prisma");
      const row = await prisma.user.findUnique({
        where: { id: token.sub },
        select: { sessionVersion: true },
      });
      if (!row || row.sessionVersion !== (typeof token.sessionVersion === "number" ? token.sessionVersion : 0)) {
        return {};
      }
      return token;
    },
  },
});
