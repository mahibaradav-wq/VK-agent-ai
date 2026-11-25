import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      if (path.startsWith("/app") || path.startsWith("/admin")) {
        return Boolean(auth?.user);
      }
      return true;
    },
    jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
        token.sessionVersion =
          typeof (user as { sessionVersion?: unknown }).sessionVersion === "number"
            ? (user as { sessionVersion: number }).sessionVersion
            : 0;
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
} satisfies NextAuthConfig;
