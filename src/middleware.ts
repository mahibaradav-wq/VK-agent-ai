import { auth } from "@/auth";

export default auth((request) => {
  if (!request.auth && request.nextUrl.pathname.startsWith("/app")) {
    const login = new URL("/login", request.nextUrl.origin);
    login.searchParams.set("next", request.nextUrl.pathname);
    return Response.redirect(login);
  }

  return undefined;
});

export const config = {
  matcher: ["/app/:path*"],
};
