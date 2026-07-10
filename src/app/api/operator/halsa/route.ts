import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravOperator } from "@/auth/session";
import { halsa } from "@/ytor/operator";

export const runtime = "nodejs";

// GET /api/operator/halsa — kö-djup, senaste worker-körning, omförsök
// senaste dygnet. Drift, aldrig innehåll.
export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravOperator(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  return NextResponse.json(await halsa(db));
}
