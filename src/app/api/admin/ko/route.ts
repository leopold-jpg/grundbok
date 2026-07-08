import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { hamtaKo } from "@/lib/admin";

export const runtime = "nodejs";

// GET /api/admin/ko?tenant=… — godkännandekön med diff omräknad mot
// GÄLLANDE policy (se hamtaKo i src/lib/admin.ts).
export async function GET(req: Request) {
  const tenantId = new URL(req.url).searchParams.get("tenant");
  if (!tenantId) return NextResponse.json({ fel: "tenant krävs" }, { status: 400 });

  const db = await getDb();
  return NextResponse.json(await hamtaKo(db, tenantId));
}
