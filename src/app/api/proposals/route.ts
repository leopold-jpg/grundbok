import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { proposalsPort } from "@/lib/proposals-port";

export const runtime = "nodejs";

// POST /api/proposals — kontraktets enda HTTP-ingång för externa agenter
// (ADR-0002). Kräver en aktiv agent (Bearer gk_…, rad i agents-tabellen):
// okänd nyckel → 401, pausad/avslutad agent → 403. Tenant-, modul- och
// scope-match upprätthålls i handleProposal. En läckt nyckel kan skapa
// förslag; den kan aldrig bokföra.
export async function POST(req: Request) {
  const db = await getDb();
  const raw = await req.json().catch(() => null);
  const svar = await proposalsPort(db, req.headers.get("authorization"), raw);
  return NextResponse.json(svar.body, { status: svar.http });
}
