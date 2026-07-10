import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravKonsult, tenantsForSession } from "@/auth/session";

export const runtime = "nodejs";

// GET /api/byra/klienter — byråns klientbolag + vem som är inloggad.
// Klientlistan kommer ur sessionens byrå, aldrig ur en parameter (WP13).
export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravKonsult(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  return NextResponse.json({
    byra: krav.session.byra!.namn,
    konsult: { id: krav.session.user.id, namn: krav.session.user.name },
    klienter: await tenantsForSession(db, krav.session),
  });
}
