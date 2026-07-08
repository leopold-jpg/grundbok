import type { PGlite, Transaction } from "@electric-sql/pglite";
import { withTenant } from "./db/tenant";
import { evaluate, hashForslag } from "./policy";
import { bokforingsadapter } from "./fortnox-mock";
import type { Forslag } from "./kontering";

// Godkännande + bokföring. Approval-gaten är enda vägen till ledgern:
// beslutet binds till konsultens identitet och en hash av EXAKT det
// förslag som godkändes. Verifikationen skrivs append-only med
// tenant-scopat löpnummer (BFL 5 kap. 7 §: verifikationsnummer).

export type BeslutsResultat =
  | { status: "avvisad" }
  | {
      status: "bokford";
      verifikation: { id: string; nummer: number; extern_ref: string };
    };

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
      tenant_id: string;
      payload: Forslag;
      hash: string;
      status: string;
      document_id: string | null;
      skill_versions: Record<string, string>;
    }>(`SELECT * FROM suggestions WHERE id = $1`, [suggestionId]);
    const forslag = sug.rows[0];
    if (!forslag) throw new Error("Förslaget finns inte (eller tillhör en annan tenant)");
    if (forslag.status !== "vantar") {
      throw new Error(`Förslaget är redan ${forslag.status}`);
    }

    // Räkna om hashen från payload — lagrad hash litas inte på blint.
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

    // Policy-motorn — deterministisk gate, inte en if-sats i UI:t.
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
    const nummer = await nastaNummer(tx, tenantId);
    const extern = await bokforingsadapter().registreraVerifikation({
      tenantId,
      nummer,
      forslag: payload,
    });

    const ver = await tx.query<{ id: string }>(
      `INSERT INTO verifications
         (tenant_id, nummer, suggestion_id, affarshandelsedatum, beskrivning,
          motpart, underlag_document_id, skill_versions, extern_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        tenantId,
        nummer,
        suggestionId,
        payload.affarshandelsedatum,
        payload.dokument.beskrivning,
        payload.dokument.motpart,
        forslag.document_id,
        JSON.stringify(forslag.skill_versions),
        extern.extern_ref,
      ],
    );
    const verId = ver.rows[0].id;

    for (const rad of payload.rader) {
      await tx.query(
        `INSERT INTO verification_rows (tenant_id, verification_id, konto, kontonamn, debet_ore, kredit_ore)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, verId, rad.konto, rad.kontonamn, rad.debet_ore, rad.kredit_ore],
      );
    }

    await tx.query(`UPDATE suggestions SET status = 'bokford' WHERE id = $1`, [suggestionId]);
    await auditera(tx, tenantId, "verifikation_registrerad", {
      verifikationId: verId,
      nummer,
      godkandAv,
      forslagsHash: aktuellHash,
      externRef: extern.extern_ref,
    });

    return {
      status: "bokford",
      verifikation: { id: verId, nummer, extern_ref: extern.extern_ref },
    } as const;
  });
}

/**
 * Rättelsepost enligt BFL 5 kap. 5 § + BFNAR 2013:2: den rättade posten
 * raderas aldrig — en ny verifikation med omvända rader och referens
 * skapas. Rättelsen är konsultens egen handling (mänsklig, auditloggad).
 */
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
    }>(`SELECT konto, kontonamn, debet_ore, kredit_ore FROM verification_rows WHERE verification_id = $1`, [
      verifikationId,
    ]);

    const nummer = await nastaNummer(tx, tenantId);
    const ny = await tx.query<{ id: string }>(
      `INSERT INTO verifications
         (tenant_id, nummer, affarshandelsedatum, beskrivning, motpart,
          underlag_document_id, rattar_verifikation, skill_versions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        tenantId,
        nummer,
        v.affarshandelsedatum,
        `Rättelse av verifikation ${v.nummer}: ${v.beskrivning}`,
        v.motpart,
        v.underlag_document_id,
        verifikationId,
        JSON.stringify(v.skill_versions),
      ],
    );
    const nyId = ny.rows[0].id;

    // Omvända rader: debet ↔ kredit.
    for (const rad of rader.rows) {
      await tx.query(
        `INSERT INTO verification_rows (tenant_id, verification_id, konto, kontonamn, debet_ore, kredit_ore)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, nyId, rad.konto, rad.kontonamn, rad.kredit_ore, rad.debet_ore],
      );
    }

    await auditera(tx, tenantId, "rattelsepost_skapad", {
      rattarVerifikation: verifikationId,
      nyVerifikation: nyId,
      nummer,
      utfordAv,
    });

    return { id: nyId, nummer };
  });
}

type Tx = Transaction;

async function nastaNummer(tx: Tx, tenantId: string): Promise<number> {
  const r = await tx.query<{ nasta: number }>(
    `SELECT COALESCE(MAX(nummer), 0) + 1 AS nasta FROM verifications WHERE tenant_id = $1`,
    [tenantId],
  );
  return Number(r.rows[0].nasta);
}

async function auditera(
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
