import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { SESSION_COOKIE } from "@/auth/session";
import { hamtaKlientInbjudan, losInKlientInbjudan } from "@/auth/klient-inbjudan";

export const runtime = "nodejs";

// Inlösen av klientinbjudan (WP20) — kundappens enda osessionerade
// endpoint. GET validerar länken (utan att konsumera den); POST löser in
// atomärt, skapar kontot och sätter sessionscookien i samma svar.

export async function GET(req: Request) {
  const db = await getDb();
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const inbjudan = await hamtaKlientInbjudan(db, token);
  if (!inbjudan) {
    return NextResponse.json(
      { fel: "Inbjudningslänken är ogiltig eller har gått ut — be er konsult om en ny" },
      { status: 404 },
    );
  }
  return NextResponse.json({ tenant_namn: inbjudan.tenant_namn, email: inbjudan.email });
}

export async function POST(req: Request) {
  const db = await getDb();
  const body = (await req.json().catch(() => ({}))) as {
    token?: string;
    namn?: string;
    losenord?: string;
  };
  if (!body.token || !body.namn?.trim() || !body.losenord) {
    return NextResponse.json({ fel: "token, namn och losenord krävs" }, { status: 400 });
  }

  try {
    const inlost = await losInKlientInbjudan(db, {
      token: body.token,
      namn: body.namn,
      losenord: body.losenord,
    });
    const svar = NextResponse.json({ ok: true });
    svar.cookies.set(SESSION_COOKIE, inlost.sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 12 * 60 * 60,
    });
    return svar;
  } catch (err) {
    return NextResponse.json(
      { fel: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
