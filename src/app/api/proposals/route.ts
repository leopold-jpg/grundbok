import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { handleProposal, type Principal } from "@/lib/decisions";

export const runtime = "nodejs";

// POST /api/proposals — kontraktets enda ingång för externa agenter
// (ADR-0002). OBS WP2-läge: autentisering med scopade agentnycklar landar
// i WP4; tills dess härleds principalen från förslagets tenant (endast
// lokal dev — endpointen får inte exponeras publikt i detta läge).
export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  if (!raw) return NextResponse.json({ fel: ["ogiltig JSON"] }, { status: 400 });

  const principal: Principal = {
    typ: "intern",
    tenant_id: typeof (raw as { tenant_id?: unknown }).tenant_id === "string"
      ? (raw as { tenant_id: string }).tenant_id
      : "",
    module: "*",
    scopes: ["proposals:write"],
    namn: "dev-utan-nyckel (WP4 låser)",
  };

  const db = await getDb();
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
