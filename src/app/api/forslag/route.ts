import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kontera } from "@/lib/kontering";
import { ExtraktionSchema } from "@/lib/extract/schema";
import { byggBokforingsProposal } from "@/lib/bokforing-modul";
import { handleProposal, type Principal } from "@/lib/decisions";

export const runtime = "nodejs";

// v0.2: UI:ts konteringsflöde är modul #1 (bokforing) och går genom
// EXAKT samma port som externa agenter — handleProposal. Ingen sidodörr.
export async function POST(req: Request) {
  const body = (await req.json()) as {
    tenant_id: string;
    document_id: string;
    extraktion: unknown;
    engine: "anthropic" | "fallback";
    engine_detalj?: string;
    affarshandelsedatum?: string;
  };

  const parsed = ExtraktionSchema.safeParse(body.extraktion);
  if (!parsed.success) {
    return NextResponse.json(
      { fel: "Extraktionen validerar inte mot schemat", detalj: parsed.error.issues },
      { status: 400 },
    );
  }

  let forslag;
  try {
    forslag = kontera(parsed.data, body.tenant_id, body.affarshandelsedatum);
  } catch (err) {
    return NextResponse.json(
      { fel: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }

  const proposal = byggBokforingsProposal({
    tenantId: body.tenant_id,
    documentId: body.document_id,
    extraktion: parsed.data,
    forslag,
    motor: body.engine,
    motorDetalj: body.engine_detalj ?? (body.engine === "anthropic" ? "claude-opus-4-8" : "fallback"),
  });

  const principal: Principal = {
    typ: "intern",
    tenant_id: body.tenant_id,
    module: "bokforing",
    scopes: ["proposals:write"],
    namn: "modul:bokforing (ui)",
  };

  const db = await getDb();
  const resultat = await handleProposal(db, principal, proposal);

  if (resultat.status === "avvisad_vid_porten") {
    return NextResponse.json({ fel: resultat.fel.join("; ") }, { status: resultat.http });
  }
  if (resultat.status === "duplicate") {
    return NextResponse.json({ fel: "Förslaget finns redan" }, { status: 409 });
  }

  return NextResponse.json({
    proposal_id: resultat.proposal_id,
    status: resultat.status,
    hash: proposal.hash,
    confidence: proposal.confidence,
    forslag: {
      ...forslag,
      // Kärnans flaggor (injection m.m.) ovanpå regelmotorns egna.
      flaggor: [...forslag.flaggor, ...resultat.flaggor.filter(
        (f) => !forslag.flaggor.some((egen) => egen.id === f.id),
      )],
    },
    missade_villkor: resultat.status === "pending" ? resultat.missade_villkor : [],
    verifikation: resultat.status === "auto_approved" ? resultat.verifikation : null,
  });
}
