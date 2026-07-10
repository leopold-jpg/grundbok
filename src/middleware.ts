import { NextResponse, type NextRequest } from "next/server";

// Grov gating i edge-läge (WP11): finns ingen sessionscookie alls
// redirectas /byra och /operator till /login. Den riktiga verifieringen
// (giltig session, rätt roll, rätt byrå) sker server-side i varje route
// via src/auth/session.ts — edge-miljön kan inte nå databasen.
export function middleware(req: NextRequest) {
  const harCookie = Boolean(req.cookies.get("grundbok_session")?.value);
  if (!harCookie) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/byra/:path*", "/operator/:path*", "/byra", "/operator"],
};
