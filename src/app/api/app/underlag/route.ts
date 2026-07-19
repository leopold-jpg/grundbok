import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravKlient } from "@/auth/session";
import { listaUnderlag } from "@/lib/intake";

export const runtime = "nodejs";

// GET /api/app/underlag (WP21/WP22) — klientens egen historik med
// härledd statusresa (mottaget → tolkat → bokfört). Tenanten kommer ur
// sessionen; RLS gör andra tenants underlag osynliga per konstruktion.
export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravKlient(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  return NextResponse.json(await listaUnderlag(db, krav.tenantId));
}
