import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { PgliteAuth } from "@/auth/pglite-auth";
import { SESSION_COOKIE, tokenUrCookieHeader } from "@/auth/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const token = tokenUrCookieHeader(req.headers.get("cookie"));
  if (token) {
    const db = await getDb();
    await new PgliteAuth(db).logout(token);
  }
  const svar = NextResponse.json({ ok: true });
  svar.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return svar;
}
