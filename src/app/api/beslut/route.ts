import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { decideProposal } from "@/lib/decisions";

export const runtime = "nodejs";

// v0.2: UI:ts "Godkänn och bokför" ÄR en Decision i beslutsmotorn —
// hash-bunden till förslagets payload, append-only i decisions-tabellen.
export async function POST(req: Request) {
  const { tenant_id, proposal_id, beslut, godkand_av, reason } = (await req.json()) as {
    tenant_id: string;
    proposal_id: string;
    beslut: "godkand" | "avvisad";
    godkand_av: string;
    reason?: string;
  };

  try {
    const db = await getDb();
    const utfall = await decideProposal(db, {
      tenantId: tenant_id,
      proposalId: proposal_id,
      outcome: beslut === "godkand" ? "approved" : "rejected",
      decidedBy: godkand_av || "konsult@byran.se",
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
