import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravKlient } from "@/auth/session";
import { hamtaUnderlagDetalj } from "@/lib/intake";

export const runtime = "nodejs";

// GET /api/app/underlag/<id> (WP21) — ett enskilt underlags resa.
// Dokument-tenant-vaktens princip (Bugbot-fixen): uppslaget går genom
// RLS, så en annan tenants underlag-id är oskiljbart från ett påhittat
// → 404, aldrig 403 (existensen får inte läcka).
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const db = await getDb();
  const krav = await kravKlient(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const { id } = await ctx.params;
  const rad = await hamtaUnderlagDetalj(db, krav.tenantId, id);
  if (!rad) return NextResponse.json({ fel: "underlaget finns inte" }, { status: 404 });
  return NextResponse.json(rad);
}
