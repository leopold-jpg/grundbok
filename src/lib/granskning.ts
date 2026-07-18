import type { PGlite } from "@electric-sql/pglite";
import { withTenant } from "./db/tenant";
import { auditera } from "./ledger";
import { loadKundConfig } from "./skills";
import { paketForTenantMall } from "@/mallar/registry";
import type { Extraktion } from "./extract/schema";
import type { Flagga } from "./kontering";

// Granskningsmotorn (WP32) — den DETERMINISTISKA implementationen av
// systempromptarnas obligatoriska granskningsordning (WP30). LLM:en
// rapporterar observationer (extraktionens observationsfält); besluten
// fattas här: flaggor, eskalering och kontoval. Samma motor körs oavsett
// om tolkningen kom från riktig LLM eller fallback — golden-testerna
// (fall 1–8, TESTUNDERLAG) låser beteendet.

export type GranskningsUtfall = {
  flaggor: Flagga[];
  /** true = ingen kontering: förslaget byggs som advisory_answer utan
   *  rader och går till granskningskön (fall 1, fall 4). */
  eskalera: boolean;
  eskaleringsSkal?: string;
  /** Förskott ≠ kostnad (fall 3): kontera 1480 i stället för kostnadskonto. */
  kostnadskontoOverride?: { konto: string; namn: string };
};

/** Normalisering för mottagarjämförelse: gemener, utan bolagsformssuffix
 *  och skiljetecken — "Café Exempel AB" ↔ "café exempel". */
function normaliseraBolagsnamn(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(ab|hb|kb|ek\.?\s*för\.?|aktiebolag)\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function mottagareMatchar(mottagare: string, tenantNamn: string): boolean {
  const a = normaliseraBolagsnamn(mottagare);
  const b = normaliseraBolagsnamn(tenantNamn);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function median(tal: number[]): number {
  const sorterade = [...tal].sort((x, y) => x - y);
  const mitt = Math.floor(sorterade.length / 2);
  return sorterade.length % 2 === 1
    ? sorterade[mitt]
    : Math.round((sorterade[mitt - 1] + sorterade[mitt]) / 2);
}

const fmtKr = (ore: number) =>
  (ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
  " kr";

/**
 * Kör hela granskningsordningen mot ett tolkat underlag. Ordningen är
 * promptarnas: mottagarkontroll FÖRST — faller den är utfallet redan
 * avgjort (eskalera, ingen kontering) och övriga kontroller är
 * meningslösa. DB-läsningarna (dubblett, anomali) går genom withTenant —
 * RLS gäller precis som för allt annat tenant-data.
 */
export async function granskaUnderlag(
  db: PGlite,
  tenantId: string,
  extraktion: Extraktion,
): Promise<GranskningsUtfall> {
  const flaggor: Flagga[] = [];

  const tenant = await db.query<{ namn: string; mall: string }>(
    `SELECT namn, mall FROM tenants WHERE id = $1`,
    [tenantId],
  );
  const tenantNamn = tenant.rows[0]?.namn ?? "";
  const tenantMall = tenant.rows[0]?.mall ?? "";

  // 1. MOTTAGARKONTROLL FÖRST (fall 1). Anger underlaget en mottagare som
  // inte är tenantens bolag: flag_wrong_tenant, ingen kontering.
  if (extraktion.mottagare && tenantNamn && !mottagareMatchar(extraktion.mottagare, tenantNamn)) {
    flaggor.push({
      id: "flag_wrong_tenant",
      niva: "varning",
      text:
        `Underlaget är ställt till "${extraktion.mottagare}" men tenanten är ` +
        `"${tenantNamn}". Ingen kontering — fel bolags underlag bokförs aldrig.`,
      data: { mottagare: extraktion.mottagare, tenant_namn: tenantNamn },
    });
    return {
      flaggor,
      eskalera: true,
      eskaleringsSkal: `Mottagarkontroll: underlaget avser inte ${tenantNamn}`,
    };
  }

  // 2. PRIVAT/VERKSAMHETSFRÄMMANDE (fall 4): flag_private_expense, ingen
  // kostnadskontering — konsulten avgör hantering (t.ex. eget uttag).
  if (extraktion.privat_indikation) {
    flaggor.push({
      id: "flag_private_expense",
      niva: "varning",
      text:
        `Underlaget framstår som privat/verksamhetsfrämmande: ` +
        `"${extraktion.privat_indikation}". Ingen kostnadskontering — konsulten avgör.`,
      data: { indikation: extraktion.privat_indikation },
    });
    return {
      flaggor,
      eskalera: true,
      eskaleringsSkal: "Privat/verksamhetsfrämmande innehåll",
    };
  }

  // 3. FÖRSKOTT ≠ KOSTNAD (fall 3): kontera 1480 vid förskottsmönster.
  let kostnadskontoOverride: GranskningsUtfall["kostnadskontoOverride"];
  if (extraktion.forskott) {
    kostnadskontoOverride = { konto: "1480", namn: "Förskott till leverantör" };
    flaggor.push({
      id: "forskott_1480",
      niva: "info",
      text:
        "Förskottsmönster (förskott/a conto/deposition): konterat 1480 Förskott " +
        "till leverantör — kostnaden bokförs vid leverans mot slutfaktura.",
    });
  }

  // 4. DELMATCHNING (fall 5): underlag↔transaktion är inte 1:1 — belopp
  // utan kvitto flaggas missing_receipt med restbeloppet. Transaktionen
  // konteras i sin helhet; restbeloppet jagas i kompletteringskön (WP33).
  if (extraktion.rest_utan_underlag_ore && extraktion.rest_utan_underlag_ore > 0) {
    flaggor.push({
      id: "missing_receipt",
      niva: "varning",
      text:
        `Delmatchning: ${fmtKr(extraktion.rest_utan_underlag_ore)} av underlaget ` +
        `saknar kvitto. Restbeloppet begärs som komplettering från kunden.`,
      data: { restbelopp_ore: extraktion.rest_utan_underlag_ore },
    });
  }

  // ÄTA-vaksamhet (fall 2) — branschpaketsregel: körs ENDAST när
  // tenantens bransch aktiverar bygg-paketet (runtime-aktivt, WP31).
  // Åberopar fakturan en känd order och beloppet överstiger det kända
  // ordervärdet → needs_review.
  if (paketForTenantMall(tenantMall).includes("bygg") && extraktion.order_ref) {
    const kund = loadKundConfig(tenantId);
    const kantVarde = kund.ordrar?.[extraktion.order_ref];
    if (kantVarde !== undefined && extraktion.netto_ore > kantVarde) {
      flaggor.push({
        id: "ata_avvikelse",
        niva: "varning",
        text:
          `ÄTA-vaksamhet: fakturan åberopar ${extraktion.order_ref} med känt ` +
          `ordervärde ${fmtKr(kantVarde)} men fakturerar ${fmtKr(extraktion.netto_ore)} ` +
          `— needs_review, stäm av ÄTA-underlag mot beställningen.`,
        data: {
          order_ref: extraktion.order_ref,
          ordervarde_ore: kantVarde,
          fakturerat_ore: extraktion.netto_ore,
        },
      });
    }
  }

  // Beloppet som dubblett- och anomalikontrollerna jämför: dokumentets
  // totalbelopp (brutto), fallback netto när brutto saknas.
  const belopp = extraktion.brutto_ore ?? extraktion.netto_ore;
  const period = extraktion.datum.slice(0, 7); // YYYY-MM

  await withTenant(db, tenantId, async (tx) => {
    // 5. DUBBLETTDETEKTERING (fall 8): samma leverantör + belopp + period
    // mot både tidigare förslag och bokförda verifikationer.
    const dubblettForslag = await tx.query<{ id: string }>(
      `SELECT id FROM proposals
       WHERE payload->>'motpart' = $1
         AND substring(payload->>'affarshandelsedatum', 1, 7) = $2
         AND status <> 'rejected'
         AND (SELECT coalesce(sum((l->>'debet_ore')::bigint), 0)
              FROM jsonb_array_elements(payload->'lines') l) = $3`,
      [extraktion.motpart, period, belopp],
    );
    const dubblettVerifikation = await tx.query<{ id: string }>(
      `SELECT v.id FROM verifications v
       JOIN verification_rows r ON r.verification_id = v.id
       WHERE v.motpart = $1 AND to_char(v.affarshandelsedatum, 'YYYY-MM') = $2
       GROUP BY v.id HAVING sum(r.debet_ore) = $3`,
      [extraktion.motpart, period, belopp],
    );
    const dubbletter = dubblettForslag.rows.length + dubblettVerifikation.rows.length;
    if (dubbletter > 0) {
      flaggor.push({
        id: "dubblett_misstankt",
        niva: "varning",
        text:
          `Möjlig dubblett: ${extraktion.motpart} med ${fmtKr(belopp)} finns redan ` +
          `registrerad i perioden ${period} (${dubbletter} träff). Konsulten avgör.`,
        data: { motpart: extraktion.motpart, belopp_ore: belopp, period },
      });
    }

    // 6. BELOPPSANOMALI (fall 7): >2× median för leverantör+tenant →
    // telemetrisignal anomaly_amount. INFO-nivå: bokföringen hindras
    // inte ("bokför men notifiera") — signalen går till audit-loggen.
    const historik = await tx.query<{ belopp: string }>(
      `SELECT sum(r.debet_ore) AS belopp FROM verifications v
       JOIN verification_rows r ON r.verification_id = v.id
       WHERE v.motpart = $1
       GROUP BY v.id`,
      [extraktion.motpart],
    );
    const belopphistorik = historik.rows.map((r) => Number(r.belopp));
    if (belopphistorik.length >= 3) {
      const med = median(belopphistorik);
      if (med > 0 && belopp > 2 * med) {
        flaggor.push({
          id: "anomaly_amount",
          niva: "info",
          text:
            `Beloppsanomali: ${fmtKr(belopp)} är mer än 2× medianen ` +
            `${fmtKr(med)} för ${extraktion.motpart}. Bokförs — konsulten notifieras.`,
          data: { belopp_ore: belopp, median_ore: med, motpart: extraktion.motpart },
        });
        await auditera(tx, tenantId, "telemetri_anomaly_amount", {
          motpart: extraktion.motpart,
          belopp_ore: belopp,
          median_ore: med,
          datum: extraktion.datum,
        });
      }
    }
  });

  return { flaggor, eskalera: false, kostnadskontoOverride };
}
