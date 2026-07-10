import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravKonsult, kravTenantIByra } from "@/auth/session";
import { beslutsLogg } from "@/ytor/byra";

export const runtime = "nodejs";

// GET /api/byra/logg?klient=…|alla&limit=… — byråns beslutslogg, nyast
// först, med decided_by uppslaget till konsultens namn.
export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravKonsult(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const params = new URL(req.url).searchParams;
  const klient = params.get("klient") ?? "alla";
  if (klient !== "alla" && !(await kravTenantIByra(db, krav.session, klient))) {
    return NextResponse.json({ fel: "klientbolaget tillhör inte din byrå" }, { status: 403 });
  }

  const raw = Number(params.get("limit") ?? 50);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 500) : 50;

  return NextResponse.json(await beslutsLogg(db, krav.session, klient, limit));
}
