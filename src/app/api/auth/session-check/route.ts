import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";

import { loadUserSessionVersion, resolveSessionToken } from "@/modules/auth/session-token";
import { prisma } from "@/server/db/prisma";

export const runtime = "nodejs";

/**
 * Node endpoint used by Edge middleware so sessionVersion invalidation is
 * consistent without importing Prisma into the Edge bundle.
 * Does not return user PII — only { valid: boolean }.
 */
export async function GET(request: Request) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ valid: false }, { status: 401 });
  }

  const token = await getToken({
    req: request,
    secret,
  });

  if (!token?.sub) {
    return NextResponse.json({ valid: false }, { status: 401 });
  }

  const current = await loadUserSessionVersion(token.sub, (id) =>
    prisma.user.findUnique({ where: { id }, select: { sessionVersion: true } }),
  );
  const resolved = resolveSessionToken(token, current);
  if (!resolved.sub) {
    return NextResponse.json({ valid: false }, { status: 401 });
  }

  return NextResponse.json({ valid: true });
}
