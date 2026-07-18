import type { PGlite } from "@electric-sql/pglite";
import type { Transaction } from "@electric-sql/pglite";
import { withTenant } from "./db/tenant";
import { auditera } from "./ledger";
import { fmtKr } from "./kontering";

// Underlagsjakten (WP33) — kompletteringskön: det klienten är skyldig
// byrån. Rader skapas automatiskt ur missing_receipt-flaggade förslag
// (porten, decisions.ts) och manuellt av konsulten ("Fråga kunden").
// Allt är tenant-scopat genom withTenant/RLS; byrå-scopningen görs i
// ytlagret (src/ytor/byra.ts) precis som för kön och loggen.

export type KompletteringsTyp = "missing_receipt" | "fraga";
export type KompletteringsStatus = "open" | "paminnd" | "klar";

export type Komplettering = {
  id: string;
  proposal_id: string;
  typ: KompletteringsTyp;
  belopp_ore: number | null;
  beskrivning: string;
  status: KompletteringsStatus;
  svar: string | null;
  skapad: string;
  senast_paminnd: string | null;
  /** Förslagets summary — kontexten konsulten (och mejlutkastet) behöver. */
  proposal_summary: string;
};

function tillIso(v: Date | string | null): string | null {
  if (v === null) return null;
  return (v instanceof Date ? v : new Date(v)).toISOString();
}

export async function hamtaKompletteringar(
  db: PGlite,
  tenantId: string,
): Promise<Komplettering[]> {
  return withTenant(db, tenantId, (tx) => hamtaKompletteringarTx(tx));
}

async function hamtaKompletteringarTx(tx: Transaction): Promise<Komplettering[]> {
  {
    const r = await tx.query<{
      id: string;
      proposal_id: string;
      typ: KompletteringsTyp;
      belopp_ore: string | null;
      beskrivning: string;
      status: KompletteringsStatus;
      svar: string | null;
      skapad: Date | string;
      senast_paminnd: Date | string | null;
      proposal_summary: string;
    }>(
      `SELECT k.id, k.proposal_id, k.typ, k.belopp_ore, k.beskrivning,
              k.status, k.svar, k.skapad, k.senast_paminnd,
              p.summary AS proposal_summary
       FROM kompletteringar k
       JOIN proposals p ON p.id = k.proposal_id
       ORDER BY (k.status = 'klar'), k.skapad ASC`,
    );
    return r.rows.map((row) => ({
      ...row,
      belopp_ore: row.belopp_ore === null ? null : Number(row.belopp_ore),
      skapad: tillIso(row.skapad)!,
      senast_paminnd: tillIso(row.senast_paminnd),
    }));
  }
}

/** Klientens hela kompletteringsläge i EN tenant-transaktion (WP34-
 *  granskningsfynd: rader + månadsstatus hämtades förut i två
 *  transaktioner, och öppna-räknaren var en COUNT av rader som redan
 *  låg i handen). */
export async function kompletteringsOversikt(
  db: PGlite,
  tenantId: string,
): Promise<{ rader: Komplettering[]; manad: ManadsStatus }> {
  return withTenant(db, tenantId, async (tx) => {
    const rader = await hamtaKompletteringarTx(tx);
    const attest = await tx.query<{ n: string }>(
      `SELECT count(*) AS n FROM proposals WHERE status = 'pending'`,
    );
    const attestVantar = Number(attest.rows[0]?.n ?? 0);
    const oppna = rader.filter((r) => r.status !== "klar").length;
    return {
      rader,
      manad: {
        attest_vantar: attestVantar,
        kompletteringar_oppna: oppna,
        gron: attestVantar === 0 && oppna === 0,
      },
    };
  });
}

/** "Fråga kunden" (WP33): konsultens fråga på ett förslag blir en
 *  kompletteringsrad typ 'fraga'. Frågan auditeras direkt — hela
 *  fråga→svar-kedjan ska gå att läsa ur Rex-dokumentationen. */
export async function skapaFraga(
  db: PGlite,
  input: { tenantId: string; proposalId: string; fraga: string; stalldAv: string },
): Promise<{ id: string }> {
  const fraga = input.fraga.trim();
  if (!fraga) throw new Error("Frågan får inte vara tom");
  return withTenant(db, input.tenantId, async (tx) => {
    const finns = await tx.query(`SELECT 1 FROM proposals WHERE id = $1`, [input.proposalId]);
    if (!finns.rows[0]) throw new Error("Förslaget finns inte (eller tillhör en annan tenant)");
    const r = await tx.query<{ id: string }>(
      `INSERT INTO kompletteringar (tenant_id, proposal_id, typ, beskrivning)
       VALUES ($1, $2, 'fraga', $3) RETURNING id`,
      [input.tenantId, input.proposalId, fraga],
    );
    await auditera(tx, input.tenantId, "komplettering_fraga", {
      kompletteringId: r.rows[0].id,
      proposalId: input.proposalId,
      fraga,
      stalldAv: input.stalldAv,
    });
    return r.rows[0];
  });
}

/** Påminnelse: status → paminnd + tidsstämpel. Mejlutkastet byggs av
 *  byggPaminnelseUtkast — mailto: räcker i natt, mejladaptern kommer i
 *  intag-passet. */
export async function markeraPamind(
  db: PGlite,
  input: { tenantId: string; kompletteringId: string; paminddAv: string },
): Promise<void> {
  await withTenant(db, input.tenantId, async (tx) => {
    const r = await tx.query<{ id: string; status: string }>(
      `UPDATE kompletteringar SET status = 'paminnd', senast_paminnd = now()
       WHERE id = $1 AND status <> 'klar' RETURNING id, status`,
      [input.kompletteringId],
    );
    if (!r.rows[0]) throw new Error("Kompletteringen finns inte eller är redan klar");
    await auditera(tx, input.tenantId, "komplettering_paminnelse", {
      kompletteringId: input.kompletteringId,
      paminddAv: input.paminddAv,
    });
  });
}

/** "Påminn"-knappen (WP34-granskningsfynd: en POST per rad var både
 *  N round-trips och icke-atomärt): ALLA öppna rader för klienten
 *  markeras påminda i en transaktion med en audit-händelse. Returnerar
 *  antalet — 0 betyder att inget fanns att påminna om. */
export async function paminnAllaOppna(
  db: PGlite,
  input: { tenantId: string; paminddAv: string },
): Promise<number> {
  return withTenant(db, input.tenantId, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `UPDATE kompletteringar SET status = 'paminnd', senast_paminnd = now()
       WHERE status <> 'klar' RETURNING id`,
      [],
    );
    if (r.rows.length > 0) {
      await auditera(tx, input.tenantId, "komplettering_paminnelse", {
        kompletteringIds: r.rows.map((rad) => rad.id),
        antal: r.rows.length,
        paminddAv: input.paminddAv,
      });
    }
    return r.rows.length;
  });
}

/** Svar registreras (fritextfält i byråvyn i natt): raden blir klar och
 *  svaret FÄSTS VID FÖRSLAGET i audit-loggen — Rex-dokumentationen av
 *  fråga→svar-kedjan. */
export async function registreraSvar(
  db: PGlite,
  input: { tenantId: string; kompletteringId: string; svar: string; registreratAv: string },
): Promise<void> {
  const svar = input.svar.trim();
  if (!svar) throw new Error("Svaret får inte vara tomt");
  await withTenant(db, input.tenantId, async (tx) => {
    const r = await tx.query<{ proposal_id: string; typ: string; beskrivning: string }>(
      `UPDATE kompletteringar SET status = 'klar', svar = $2
       WHERE id = $1 AND status <> 'klar'
       RETURNING proposal_id, typ, beskrivning`,
      [input.kompletteringId, svar],
    );
    const rad = r.rows[0];
    if (!rad) throw new Error("Kompletteringen finns inte eller är redan klar");
    await auditera(tx, input.tenantId, "kompletteringssvar", {
      kompletteringId: input.kompletteringId,
      proposalId: rad.proposal_id,
      typ: rad.typ,
      fraga: rad.beskrivning,
      svar,
      registreratAv: input.registreratAv,
    });
  });
}

/** Månadsgrönt v0 (WP33): per klient — grön när attestkön är tom OCH
 *  kompletteringskön är tom. Beräknas ur nuläget (pending + open/paminnd),
 *  aldrig ur lagrade räknare (samma princip som telemetrivyn, ADR-0004). */
export type ManadsStatus = {
  attest_vantar: number;
  kompletteringar_oppna: number;
  gron: boolean;
};

export async function manadsStatus(db: PGlite, tenantId: string): Promise<ManadsStatus> {
  return withTenant(db, tenantId, async (tx) => {
    const r = await tx.query<{ attest: string; komp: string }>(
      `SELECT
         (SELECT count(*) FROM proposals WHERE status = 'pending') AS attest,
         (SELECT count(*) FROM kompletteringar WHERE status <> 'klar') AS komp`,
    );
    const attest = Number(r.rows[0]?.attest ?? 0);
    const komp = Number(r.rows[0]?.komp ?? 0);
    return { attest_vantar: attest, kompletteringar_oppna: komp, gron: attest === 0 && komp === 0 };
  });
}

/** Det färdiga, vänliga mejlutkastet för "Påminn" — konsulten ska aldrig
 *  formulera jakten själv. Returnerar subject + body för en mailto-länk
 *  (mejladressen fylls i av konsulten tills mejladaptern finns). */
export function byggPaminnelseUtkast(
  klientNamn: string,
  rader: Pick<Komplettering, "typ" | "beskrivning" | "belopp_ore" | "proposal_summary">[],
): { subject: string; body: string } {
  const punkter = rader.map((k) => {
    const belopp = k.belopp_ore ? ` (${fmtKr(k.belopp_ore)})` : "";
    return k.typ === "missing_receipt"
      ? `• Kvitto/underlag saknas${belopp}: ${k.proposal_summary}`
      : `• Fråga om "${k.proposal_summary}": ${k.beskrivning}`;
  });
  return {
    subject: `Komplettering till bokföringen — ${klientNamn}`,
    body:
      `Hej!\n\n` +
      `För att vi ska kunna hålla bokföringen för ${klientNamn} uppdaterad ` +
      `behöver vi din hjälp med följande:\n\n` +
      `${punkter.join("\n")}\n\n` +
      `Svara gärna på det här mejlet med underlag eller svar, så bokför vi direkt.\n\n` +
      `Tack på förhand!\nVänliga hälsningar`,
  };
}
