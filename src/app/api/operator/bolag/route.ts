import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravOperator } from "@/auth/session";
import { bolagsoversikt } from "@/ytor/operator";

export const runtime = "nodejs";

// GET /api/operator/bolag — byråer → klientbolag → agenter/förslag som
// AGGREGAT. Operatören ser aldrig förslags-innehåll (WP15 smoke-testar).
export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravOperator(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  return NextResponse.json(await bolagsoversikt(db));
}
