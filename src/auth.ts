import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
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
          process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
        ).authenticate(email, password);

        if (!result.ok) {
          return null;
        }

        return result.user;
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
});
