import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { decideProposal } from "@/lib/decisions";

export const runtime = "nodejs";

// POST /api/admin/beslut — det mänskliga beslutet på ett köat förslag.
// Hash-bindningen och avvisnings-motiveringen upprätthålls av
// decideProposal; routen översätter bara fel till 422 { fel }.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    tenant_id?: unknown;
    proposal_id?: unknown;
    outcome?: unknown;
    decided_by?: unknown;
    reason?: unknown;
  } | null;
  if (!body) return NextResponse.json({ fel: "ogiltig JSON" }, { status: 400 });

  const { tenant_id, proposal_id, outcome, decided_by, reason } = body;
  if (
    typeof tenant_id !== "string" ||
    typeof proposal_id !== "string" ||
    typeof decided_by !== "string" ||
    !tenant_id ||
    !proposal_id ||
    !decided_by ||
    (outcome !== "approved" && outcome !== "rejected") ||
    (reason !== undefined && typeof reason !== "string")
  ) {
    return NextResponse.json(
      { fel: "tenant_id, proposal_id, decided_by och outcome ('approved'|'rejected') krävs" },
      { status: 400 },
    );
  }

  try {
    const db = await getDb();
    const resultat = await decideProposal(db, {
      tenantId: tenant_id,
      proposalId: proposal_id,
      outcome,
      decidedBy: decided_by,
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
