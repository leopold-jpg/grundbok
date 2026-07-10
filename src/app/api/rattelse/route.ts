import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant";
import { isoDatum } from "@/lib/ledger";
import { hashProposal, sha256Hex, type Proposal } from "@/contracts";
import { handleProposal, decideProposal, type Principal } from "@/lib/decisions";
import { kravKonsult, kravTenantIByra } from "@/auth/session";

export const runtime = "nodejs";

// v0.2: en rättelse är ett correction-FÖRSLAG genom samma port som allt
// annat. Hårda regeln i beslutsmotorn gör att correction aldrig auto-
// godkänns — här fattar konsulten beslutet direkt (rättelsen är konsultens
// egen, mänskliga handling i UI:t), så förslaget godkänns i samma request.
export async function POST(req: Request) {
  const db = await getDb();
  // WP11: rättelser är konsultens handling — identiteten ur sessionen.
  const krav = await kravKonsult(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const { tenant_id, verification_id } = (await req.json()) as {
    tenant_id: string;
    verification_id: string;
  };
  if (!(await kravTenantIByra(db, krav.session, tenant_id))) {
    return NextResponse.json({ fel: "klientbolaget tillhör inte din byrå" }, { status: 403 });
  }
  const konsult = krav.session.user.id;

  try {

    const original = await withTenant(db, tenant_id, async (tx) => {
      const v = await tx.query<{
        id: string;
        nummer: number;
        affarshandelsedatum: string;
        beskrivning: string;
        motpart: string;
        skill_versions: Record<string, string>;
      }>(`SELECT * FROM verifications WHERE id = $1`, [verification_id]);
      if (!v.rows[0]) {
        throw new Error("Verifikationen finns inte (eller tillhör en annan tenant)");
      }
      const rader = await tx.query<{
        konto: string;
        kontonamn: string;
        debet_ore: number;
        kredit_ore: number;
      }>(
        `SELECT konto, kontonamn, debet_ore, kredit_ore FROM verification_rows WHERE verification_id = $1`,
        [verification_id],
      );
      return { ...v.rows[0], rader: rader.rows };
    });

    const utanHash: Omit<Proposal, "hash"> = {
      contract_version: "0.2.0",
      id: randomUUID(),
      tenant_id,
      module: "bokforing",
      kind: "correction",
      affarshandelsedatum: isoDatum(original.affarshandelsedatum),
      motpart: original.motpart,
      summary: `Rättelse av verifikation ${original.nummer}: ${original.beskrivning}`.slice(0, 300),
      // Omvända rader: debet ↔ kredit (BFL 5:5 + BFNAR 2013:2).
      lines: original.rader.map((r) => ({
        konto: r.konto,
        benamning: r.kontonamn,
        debet_ore: Number(r.kredit_ore),
        kredit_ore: Number(r.debet_ore),
      })),
      legal: [
        {
          lagrum: "BFL (1999:1078) 5 kap. 5 § + BFNAR 2013:2",
          ruleset: `se/bas-kontering@${original.skill_versions["se/bas-kontering"] ?? "1.0.0"}`,
        },
      ],
      confidence: 1, // mänskligt initierad — konfidensen är konsultens
      provenance: {
        model: "manuell:konsult",
        prompt_hash: sha256Hex("rattelse-ui@0.2.0"),
        module_version: "0.2.0",
        input_refs: [`verification:${verification_id}`],
        injection_screened: true,
      },
    };
    const proposal: Proposal = { ...utanHash, hash: hashProposal(utanHash) };

    const principal: Principal = {
      typ: "intern",
      tenant_id,
      module: "bokforing",
      scopes: ["proposals:write"],
      namn: `konsult:${konsult}`,
    };

    const db2 = db;
    const inlamnat = await handleProposal(db2, principal, proposal);
    if (inlamnat.status !== "pending") {
      throw new Error(
        `Väntade correction i kö, fick ${inlamnat.status}${
          inlamnat.status === "avvisad_vid_porten" ? `: ${inlamnat.fel.join("; ")}` : ""
        }`,
      );
    }

    const beslut = await decideProposal(db, {
      tenantId: tenant_id,
      proposalId: proposal.id,
      outcome: "approved",
      decidedBy: konsult,
    });
    if (beslut.outcome !== "approved" || !beslut.verifikation) {
      throw new Error("Rättelsen kunde inte bokföras");
    }

    return NextResponse.json({
      id: beslut.verifikation.id,
      nummer: beslut.verifikation.nummer,
      proposal_id: proposal.id,
    });
  } catch (err) {
    return NextResponse.json(
      { fel: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
