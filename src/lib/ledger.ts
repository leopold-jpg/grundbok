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

// ===================================================================
// v1-kompatibilitetslager — RIVS I WP3 (ersätts av beslutsmotorn i
// src/lib/decisions.ts). Behålls genom WP2 så att testsviten är grön
// per arbetspaket.
// ===================================================================

import { evaluate, hashForslag } from "./policy";
import type { Forslag } from "./kontering";

export type BeslutsResultat =
  | { status: "avvisad" }
  | { status: "bokford"; verifikation: SkrivenVerifikation };

export async function fattaBeslut(
  db: PGlite,
  tenantId: string,
  suggestionId: string,
  beslut: "godkand" | "avvisad",
  godkandAv: string,
  kommentar?: string,
): Promise<BeslutsResultat> {
  return withTenant(db, tenantId, async (tx) => {
    const sug = await tx.query<{
      id: string;
      payload: Forslag;
      status: string;
      document_id: string | null;
      skill_versions: Record<string, string>;
    }>(`SELECT * FROM suggestions WHERE id = $1`, [suggestionId]);
    const forslag = sug.rows[0];
    if (!forslag) throw new Error("Förslaget finns inte (eller tillhör en annan tenant)");
    if (forslag.status !== "vantar") throw new Error(`Förslaget är redan ${forslag.status}`);

    const aktuellHash = hashForslag(forslag.payload);
    await tx.query(
      `INSERT INTO approvals (tenant_id, suggestion_id, beslut, suggestion_hash, godkand_av, kommentar)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, suggestionId, beslut, aktuellHash, godkandAv, kommentar ?? null],
    );

    if (beslut === "avvisad") {
      await tx.query(`UPDATE suggestions SET status = 'avvisad' WHERE id = $1`, [suggestionId]);
      await auditera(tx, tenantId, "forslag_avvisat", { suggestionId, godkandAv });
      return { status: "avvisad" } as const;
    }

    const policybeslut = evaluate({
      handling: "registrera_verifikation",
      tenantId,
      kontextTenantId: tenantId,
      roll: "konsult",
      godkannande: { beslut, suggestionHash: aktuellHash, godkandAv },
      aktuellForslagsHash: aktuellHash,
    });
    if (policybeslut.beslut === "neka") {
      throw new Error(`Policy-motorn nekade: ${policybeslut.skal}`);
    }

    const payload = forslag.payload;
    const verifikation = await skrivVerifikation(tx, tenantId, {
      affarshandelsedatum: payload.affarshandelsedatum,
      beskrivning: payload.dokument.beskrivning,
      motpart: payload.dokument.motpart,
      lines: payload.rader.map((r) => ({
        konto: r.konto,
        benamning: r.kontonamn,
        debet_ore: r.debet_ore,
        kredit_ore: r.kredit_ore,
      })),
      underlagDocumentId: forslag.document_id,
      skillVersions: forslag.skill_versions,
    });

    await tx.query(`UPDATE suggestions SET status = 'bokford' WHERE id = $1`, [suggestionId]);
    await auditera(tx, tenantId, "verifikation_registrerad", {
      verifikationId: verifikation.id,
      nummer: verifikation.nummer,
      godkandAv,
      forslagsHash: aktuellHash,
      externRef: verifikation.extern_ref,
    });

    return { status: "bokford", verifikation } as const;
  });
}

export async function skapaRattelse(
  db: PGlite,
  tenantId: string,
  verifikationId: string,
  utfordAv: string,
): Promise<{ id: string; nummer: number }> {
  return withTenant(db, tenantId, async (tx) => {
    const orig = await tx.query<{
      id: string;
      nummer: number;
      affarshandelsedatum: string;
      beskrivning: string;
      motpart: string;
      underlag_document_id: string | null;
      skill_versions: Record<string, string>;
    }>(`SELECT * FROM verifications WHERE id = $1`, [verifikationId]);
    const v = orig.rows[0];
    if (!v) throw new Error("Verifikationen finns inte (eller tillhör en annan tenant)");

    const rader = await tx.query<{
      konto: string;
      kontonamn: string;
      debet_ore: number;
      kredit_ore: number;
    }>(
      `SELECT konto, kontonamn, debet_ore, kredit_ore FROM verification_rows WHERE verification_id = $1`,
      [verifikationId],
    );

    const ny = await skrivVerifikation(tx, tenantId, {
      affarshandelsedatum: isoDatum(v.affarshandelsedatum),
      beskrivning: `Rättelse av verifikation ${v.nummer}: ${v.beskrivning}`,
      motpart: v.motpart,
      lines: rader.rows.map((r) => ({
        konto: r.konto,
        benamning: r.kontonamn,
        debet_ore: Number(r.kredit_ore),
        kredit_ore: Number(r.debet_ore),
      })),
      underlagDocumentId: v.underlag_document_id,
      rattarVerifikation: verifikationId,
      skillVersions: v.skill_versions,
    });

    await auditera(tx, tenantId, "rattelsepost_skapad", {
      rattarVerifikation: verifikationId,
      nyVerifikation: ny.id,
      nummer: ny.nummer,
      utfordAv,
    });

    return { id: ny.id, nummer: ny.nummer };
  });
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
