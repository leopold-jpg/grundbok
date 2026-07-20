import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravKlient } from "@/auth/session";
import { lagesSiffror } from "@/lib/intake";

export const runtime = "nodejs";

// Läget (WP22): kundappens hemyta — ENDAST obestridliga siffror i v1,
// räknade i SQL över alla underlag (lagesSiffror — aldrig ett list-tak).
// Resultat och saldon är en per-klient-flagga byrån slår på senare
// (default av) — den vägen byggs inte här.
export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravKlient(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  return NextResponse.json(await lagesSiffror(db, krav.tenantId));
}
