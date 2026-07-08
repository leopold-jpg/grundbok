import type { PGlite, Transaction } from "@electric-sql/pglite";
import { withTenant } from "./db/tenant";
import { bokforingsadapter } from "./fortnox-mock";
import type { ProposalLine } from "@/contracts";

// Huvudbokens enda skrivpunkt. Efter ADR-0002 anropas skrivVerifikation
// uteslutande av beslutsmotorn (src/lib/decisions.ts) — ett förslag som
// passerat gaten (policy-auto eller hash-bundet mänskligt beslut) blir en
// append-only-verifikation med tenant-scopat löpnummer (BFL 5 kap. 7 §).

type Tx = Transaction;

export type VerifikationsInput = {
  affarshandelsedatum: string;
  beskrivning: string;
  motpart: string;
  lines: ProposalLine[];
  proposalId?: string | null;
  underlagDocumentId?: string | null;
  rattarVerifikation?: string | null;
  skillVersions?: Record<string, string>;
};

export type SkrivenVerifikation = { id: string; nummer: number; extern_ref: string };

/** Postgres date-kolumner kan komma tillbaka som Date-objekt — normalisera till ISO-datum. */
export function isoDatum(d: unknown): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

export async function skrivVerifikation(
  tx: Tx,
  tenantId: string,
  input: VerifikationsInput,
): Promise<SkrivenVerifikation> {
  if (input.rattarVerifikation) {
    // Rättelsen måste peka på en verifikation som finns — och RLS
    // garanterar att den tillhör samma tenant.
    const orig = await tx.query<{ id: string }>(
      `SELECT id FROM verifications WHERE id = $1`,
      [input.rattarVerifikation],
    );
    if (!orig.rows[0]) {
      throw new Error(
        "Rättelsens verifikationsreferens finns inte (eller tillhör en annan tenant)",
      );
    }
  }

  const nummer = await nastaNummer(tx, tenantId);
  const extern = await bokforingsadapter().registreraVerifikation({
    tenantId,
    nummer,
    affarshandelsedatum: input.affarshandelsedatum,
  });

  const ver = await tx.query<{ id: string }>(
    `INSERT INTO verifications
       (tenant_id, nummer, proposal_id, affarshandelsedatum, beskrivning,
        motpart, underlag_document_id, rattar_verifikation, skill_versions, extern_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      tenantId,
      nummer,
      input.proposalId ?? null,
      input.affarshandelsedatum,
      input.beskrivning,
      input.motpart,
      input.underlagDocumentId ?? null,
      input.rattarVerifikation ?? null,
      JSON.stringify(input.skillVersions ?? {}),
      extern.extern_ref,
    ],
  );
  const verId = ver.rows[0].id;

  for (const rad of input.lines) {
    await tx.query(
      `INSERT INTO verification_rows (tenant_id, verification_id, konto, kontonamn, debet_ore, kredit_ore)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, verId, rad.konto, rad.benamning, rad.debet_ore, rad.kredit_ore],
    );
  }

  return { id: verId, nummer, extern_ref: extern.extern_ref };
}

export async function nastaNummer(tx: Tx, tenantId: string): Promise<number> {
  const r = await tx.query<{ nasta: number }>(
    `SELECT COALESCE(MAX(nummer), 0) + 1 AS nasta FROM verifications WHERE tenant_id = $1`,
    [tenantId],
  );
  return Number(r.rows[0].nasta);
}

export async function auditera(
  tx: Tx,
  tenantId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.query(
    `INSERT INTO audit_log (tenant_id, event_type, payload) VALUES ($1, $2, $3)`,
    [tenantId, eventType, JSON.stringify(payload)],
  );
}

/** Saldo för ett konto (debet − kredit, ören) — tenant-scopat via RLS.
 *  Läs-ytan för rådgivningsmodulens ledger:read-scope. */
export async function kontosaldo(
  db: PGlite,
  tenantId: string,
  konto: string,
): Promise<number> {
  return withTenant(db, tenantId, async (tx) => {
    const r = await tx.query<{ saldo: string }>(
      `SELECT COALESCE(SUM(debet_ore - kredit_ore), 0) AS saldo
       FROM verification_rows WHERE konto = $1`,
      [konto],
    );
    return Number(r.rows[0].saldo);
  });
}
