import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

const DEFAULT_SESSION_CHECK_TIMEOUT_MS = 3_000;

function sessionCheckTimeoutMs() {
  const parsed = Number(process.env.SESSION_CHECK_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SESSION_CHECK_TIMEOUT_MS;
}

/**
 * The session cookie is forwarded to this origin, so it must never be derived
 * from the (client-controlled) Host header. Defaults to the local server port.
 */
function sessionCheckOrigin() {
  const configured = process.env.SESSION_CHECK_ORIGIN?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return `http://127.0.0.1:${process.env.PORT || "3000"}`;
}

/**
 * Edge middleware: decode JWT locally, then confirm sessionVersion via the
 * Node session-check route so password-reset invalidation matches Node auth().
 * Fail closed if the check cannot run (no weaker auth on Edge).
 */
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const needsAuth = path.startsWith("/app") || path.startsWith("/admin");
  if (!needsAuth) {
    return NextResponse.next();
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const token = await getToken({
    req: request,
    secret,
  });

  if (!token?.sub) {
    const login = new URL("/login", request.url);
    login.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(login);
  }

  const checkUrl = new URL("/api/auth/session-check", sessionCheckOrigin());
  let valid = false;
  try {
    const response = await fetch(checkUrl, {
      headers: {
        cookie: request.headers.get("cookie") ?? "",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(sessionCheckTimeoutMs()),
    });
    if (response.ok) {
      const body = (await response.json()) as { valid?: unknown };
      valid = body.valid === true;
    }
  } catch {
    valid = false;
  }

  if (!valid) {
    const login = new URL("/login", request.url);
    login.searchParams.set("session", "expired");
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/admin", "/admin/:path*"],
};
