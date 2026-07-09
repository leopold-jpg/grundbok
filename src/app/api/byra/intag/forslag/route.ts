import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kontera } from "@/lib/kontering";
import { ExtraktionSchema } from "@/lib/extract/schema";
import { byggBokforingsProposal } from "@/lib/bokforing-modul";
import { handleProposal, type Principal } from "@/lib/decisions";
import { kravKonsult, kravTenantIByra } from "@/auth/session";
import { dokumentHorTillKlient } from "@/ytor/byra";

export const runtime = "nodejs";

// POST /api/byra/intag/forslag — konteringsförslaget ur intaget (WP13).
// Samma port som allt annat (handleProposal), men bakom konsult-session
// och byrå-vakt. Ingen sidodörr.
export async function POST(req: Request) {
  const db = await getDb();
  const krav = await kravKonsult(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const body = (await req.json().catch(() => ({}))) as {
    tenant_id?: string;
    document_id?: string;
    extraktion?: unknown;
    engine?: "anthropic" | "fallback";
    engine_detalj?: string;
    affarshandelsedatum?: string;
  };
  if (!body.tenant_id || !body.document_id) {
    return NextResponse.json({ fel: "tenant_id och document_id krävs" }, { status: 400 });
  }
  if (!(await kravTenantIByra(db, krav.session, body.tenant_id))) {
    return NextResponse.json({ fel: "klientbolaget tillhör inte din byrå" }, { status: 403 });
  }
  // Bugbot PR #2: underlaget måste höra till klienten — annars kan
  // förslagets provenance peka på en annan klients dokument.
  if (!(await dokumentHorTillKlient(db, body.tenant_id, body.document_id))) {
    return NextResponse.json({ fel: "underlaget hör inte till klienten" }, { status: 400 });
  }

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
    motor: body.engine ?? "fallback",
    motorDetalj:
      body.engine_detalj ?? (body.engine === "anthropic" ? "claude-opus-4-8" : "fallback"),
  });

  const principal: Principal = {
    typ: "intern",
    tenant_id: body.tenant_id,
    module: "bokforing",
    scopes: ["proposals:write"],
    namn: `konsult:${krav.session.user.id}`,
  };

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
      flaggor: [
        ...forslag.flaggor,
        ...resultat.flaggor.filter((f) => !forslag.flaggor.some((egen) => egen.id === f.id)),
      ],
    },
    missade_villkor: resultat.status === "pending" ? resultat.missade_villkor : [],
    verifikation: resultat.status === "auto_approved" ? resultat.verifikation : null,
  });
}
