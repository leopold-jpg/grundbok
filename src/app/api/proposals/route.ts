import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { handleProposal } from "@/lib/decisions";
import { verifieraAgentNyckel } from "@/lib/agent-auth";

export const runtime = "nodejs";

// POST /api/proposals — kontraktets enda HTTP-ingång för externa agenter
// (ADR-0002). Kräver en scopad agentnyckel (Bearer gk_…): nyckelns tenant
// måste matcha förslagets tenant_id, modulen måste matcha, och scopet
// proposals:write krävs — allt upprätthålls i handleProposal. En läckt
// nyckel kan skapa förslag; den kan aldrig bokföra.
export async function POST(req: Request) {
  const db = await getDb();

  const principal = await verifieraAgentNyckel(db, req.headers.get("authorization"));
  if (!principal) {
    return NextResponse.json(
      { fel: ["giltig agentnyckel krävs (Authorization: Bearer gk_…)"] },
      { status: 401 },
    );
  }

  const raw = await req.json().catch(() => null);
  if (!raw) return NextResponse.json({ fel: ["ogiltig JSON"] }, { status: 400 });

  const resultat = await handleProposal(db, principal, raw);

  switch (resultat.status) {
    case "avvisad_vid_porten":
      return NextResponse.json({ fel: resultat.fel }, { status: resultat.http });
    case "duplicate":
      return NextResponse.json(resultat, { status: 200 });
    case "pending":
      return NextResponse.json(resultat, { status: 202 });
    case "auto_approved":
      return NextResponse.json(resultat, { status: 201 });
  }
}
