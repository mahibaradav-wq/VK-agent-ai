import type { NextAuthConfig } from "next-auth";

import { stampTokenSessionVersion } from "@/modules/auth/session-token";

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
        return stampTokenSessionVersion(token, {
          id: user.id,
          sessionVersion: (user as { sessionVersion?: unknown }).sessionVersion,
        });
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        if (typeof token.sessionVersion === "number") {
          (session.user as { sessionVersion?: number }).sessionVersion = token.sessionVersion;
        }
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
