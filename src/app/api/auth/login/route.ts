import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { PgliteAuth } from "@/auth/pglite-auth";
import { SESSION_COOKIE } from "@/auth/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { email, password } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };
  if (!email || !password) {
    return NextResponse.json({ fel: "email och password krävs" }, { status: 400 });
  }

  const db = await getDb();
  const auth = new PgliteAuth(db);
  const inloggning = await auth.login(email, password);
  if (!inloggning) {
    return NextResponse.json({ fel: "fel e-post eller lösenord" }, { status: 401 });
  }

  const session = await auth.session(inloggning.token);
  const svar = NextResponse.json({
    ok: true,
    operator: session?.user.is_operator ?? false,
    byra: session?.byra?.namn ?? null,
    klient: Boolean(session?.klient),
  });
  svar.cookies.set(SESSION_COOKIE, inloggning.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return svar;
}
