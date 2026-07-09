import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravKonsult, kravTenantIByra } from "@/auth/session";
import { klientAgenter } from "@/ytor/byra";

export const runtime = "nodejs";

// GET /api/byra/klient/agenter?klient=… — LÄSVY (WP13): konsulten ser
// vilka agenter som är igång för klienten. Provisionering, pausning och
// nycklar är operatörens yta (/operator) — aldrig byråns.
export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravKonsult(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const klient = new URL(req.url).searchParams.get("klient");
  if (!klient) return NextResponse.json({ fel: "klient krävs" }, { status: 400 });
  if (!(await kravTenantIByra(db, krav.session, klient))) {
    return NextResponse.json({ fel: "klientbolaget tillhör inte din byrå" }, { status: 403 });
  }

  return NextResponse.json(await klientAgenter(db, klient));
}
