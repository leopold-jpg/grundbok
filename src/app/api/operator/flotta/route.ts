import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravOperator } from "@/auth/session";
import { flottoversikt } from "@/ytor/operator";

export const runtime = "nodejs";

// GET /api/operator/flotta — hela agentflottan ur agent_telemetry (WP13,
// ADR-0004). Aggregat och driftmetadata, aldrig förslags-innehåll.
export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravOperator(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  return NextResponse.json(await flottoversikt(db));
}
