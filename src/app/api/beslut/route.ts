import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { decideProposal } from "@/lib/decisions";
import { kravKonsult, kravTenantIByra } from "@/auth/session";

export const runtime = "nodejs";

// WP11: attest kräver en verifierad identitet — decided_by är den
// inloggade konsultens user-id, aldrig en sträng ur requesten. Utan
// session är attest omöjlig (WP15 smoke-testar detta).
export async function POST(req: Request) {
  const db = await getDb();
  const krav = await kravKonsult(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const { tenant_id, proposal_id, beslut, reason } = (await req.json()) as {
    tenant_id: string;
    proposal_id: string;
    beslut: "godkand" | "avvisad";
    reason?: string;
  };

  if (!(await kravTenantIByra(db, krav.session, tenant_id))) {
    return NextResponse.json(
      { fel: "klientbolaget tillhör inte din byrå" },
      { status: 403 },
    );
  }

  try {
    const utfall = await decideProposal(db, {
      tenantId: tenant_id,
      proposalId: proposal_id,
      outcome: beslut === "godkand" ? "approved" : "rejected",
      decidedBy: krav.session.user.id,
      reason,
    });
    if (utfall.outcome === "rejected") {
      return NextResponse.json({ status: "avvisad" });
    }
    return NextResponse.json({ status: "bokford", verifikation: utfall.verifikation });
  } catch (err) {
    return NextResponse.json(
      { fel: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
