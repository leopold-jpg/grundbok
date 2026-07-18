import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravOperator } from "@/auth/session";
import { agentDetalj } from "@/ytor/operator";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// GET /api/operator/flotta/[id] — agentdetalj: policy, nyckelscopes och
// senaste 20 förslagen som DRIFTRADER (WP13). Skrivningar går via
// PATCH /api/agents/[id] (pausa/återuppta) — inget skrivs här.
export async function GET(req: Request, { params }: Params) {
  const db = await getDb();
  const krav = await kravOperator(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const { id } = await params;
  const detalj = await agentDetalj(db, id);
  if (!detalj) return NextResponse.json({ fel: "agenten finns inte" }, { status: 404 });
  return NextResponse.json(detalj);
}
