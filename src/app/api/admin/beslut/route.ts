import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { decideProposal } from "@/lib/decisions";
import { kravKonsult, kravTenantIByra } from "@/auth/session";

export const runtime = "nodejs";

// WP11: attest kräver verifierad identitet — decided_by är den inloggade
// konsultens user-id, aldrig en sträng ur requesten. Hash-bindningen och
// avvisnings-motiveringen upprätthålls av decideProposal. (Kön flyttar
// till /byra i WP13; identitetsgaten gäller redan nu.)
export async function POST(req: Request) {
  const db = await getDb();
  const krav = await kravKonsult(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const body = (await req.json().catch(() => null)) as {
    tenant_id?: unknown;
    proposal_id?: unknown;
    outcome?: unknown;
    reason?: unknown;
  } | null;
  if (!body) return NextResponse.json({ fel: "ogiltig JSON" }, { status: 400 });

  const { tenant_id, proposal_id, outcome, reason } = body;
  if (
    typeof tenant_id !== "string" ||
    typeof proposal_id !== "string" ||
    !tenant_id ||
    !proposal_id ||
    (outcome !== "approved" && outcome !== "rejected") ||
    (reason !== undefined && typeof reason !== "string")
  ) {
    return NextResponse.json(
      { fel: "tenant_id, proposal_id och outcome ('approved'|'rejected') krävs" },
      { status: 400 },
    );
  }

  if (!(await kravTenantIByra(db, krav.session, tenant_id))) {
    return NextResponse.json(
      { fel: "klientbolaget tillhör inte din byrå" },
      { status: 403 },
    );
  }

  try {
    const resultat = await decideProposal(db, {
      tenantId: tenant_id,
      proposalId: proposal_id,
      outcome,
      decidedBy: krav.session.user.id,
      reason,
    });
    return NextResponse.json(resultat);
  } catch (err) {
    return NextResponse.json(
      { fel: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
