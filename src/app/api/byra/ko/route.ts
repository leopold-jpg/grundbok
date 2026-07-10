import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravKonsult, kravTenantIByra } from "@/auth/session";
import { attestKo } from "@/ytor/byra";

export const runtime = "nodejs";

// GET /api/byra/ko?klient=…|alla — attestkön, diff omräknad mot gällande
// policy (hamtaKo). "alla" = byråns samtliga klienter.
export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravKonsult(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const klient = new URL(req.url).searchParams.get("klient") ?? "alla";
  if (klient !== "alla" && !(await kravTenantIByra(db, krav.session, klient))) {
    return NextResponse.json({ fel: "klientbolaget tillhör inte din byrå" }, { status: 403 });
  }

  return NextResponse.json(await attestKo(db, krav.session, klient));
}
