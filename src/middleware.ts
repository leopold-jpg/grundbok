import { NextResponse, type NextRequest } from "next/server";

// Grov gating i edge-läge (WP11): finns ingen sessionscookie alls
// redirectas /byra, /operator och /app till /login. Den riktiga
// verifieringen (giltig session, rätt roll, rätt byrå/tenant) sker
// server-side i varje route via src/auth/session.ts — edge-miljön kan
// inte nå databasen.
export function middleware(req: NextRequest) {
  // Inbjudningssidan (WP20) är kundappens enda osessionerade yta —
  // det är där kunden FÅR sin session. Exakt segment, inte prefix.
  const { pathname } = req.nextUrl;
  if (pathname === "/app/inbjudan" || pathname.startsWith("/app/inbjudan/")) {
    return NextResponse.next();
  }
  const harCookie = Boolean(req.cookies.get("grundbok_session")?.value);
  if (!harCookie) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/byra/:path*", "/operator/:path*", "/byra", "/operator", "/app/:path*", "/app"],
};
