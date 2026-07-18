import type { PGlite } from "@electric-sql/pglite";
import { withTenant } from "./db/tenant";
import { loadKundConfig } from "./skills";
import { paketForTenantMall, type BranschPaketId } from "@/mallar/registry";
import type { Extraktion } from "./extract/schema";
import { fmtKr, type Flagga } from "./kontering";

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

/** Normalisering för mottagarjämförelse: gemener, diakritik vikt bort
 *  (OCR/LLM tappar ofta accenter: "Café" → "Cafe"), utan bolagsforms-
 *  suffix och skiljetecken — "Café Exempel AB" ↔ "cafe exempel". */
export function normaliseraBolagsnamn(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/\b(ab|hb|kb|ek\.?\s*for\.?|aktiebolag)\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Ordmängdsjämförelse, inte substring (granskningsfynd WP34): tenanten
 *  "Bygg AB" får inte matcha mottagaren "Byggmax AB" bara för att
 *  strängen råkar vara ett prefix. Match = ena namnets ord är en
 *  delmängd av det andras. */
export function mottagareMatchar(mottagare: string, tenantNamn: string): boolean {
  const a = normaliseraBolagsnamn(mottagare).split(" ").filter(Boolean);
  const b = normaliseraBolagsnamn(tenantNamn).split(" ").filter(Boolean);
  if (a.length === 0 || b.length === 0) return false;
  const aSet = new Set(a);
  const bSet = new Set(b);
  return a.every((ord) => bSet.has(ord)) || b.every((ord) => aSet.has(ord));
}

function median(tal: number[]): number {
  const sorterade = [...tal].sort((x, y) => x - y);
  const mitt = Math.floor(sorterade.length / 2);
  return sorterade.length % 2 === 1
    ? sorterade[mitt]
    : Math.round((sorterade[mitt - 1] + sorterade[mitt]) / 2);
}

/** Anropskontext (granskningsfynd WP34): tenant-raden är redan uppslagen
 *  av workern och paketaktiveringen är mall∩tenant-snittet
 *  (aktivaBranschpaket) — beslutet fattas EN gång hos anroparen, aldrig
 *  om-härlett här. Utelämnad kontext (äldre anropare) → egen uppslagning
 *  och tenant-härledd aktivering. */
export type GranskningsKontext = {
  tenantNamn?: string;
  tenantMall?: string;
  /** De paket som faktiskt är aktiva för (mall, tenant). Utelämnad =
   *  härled ur tenantMall; tom lista = inga paket (t.ex. mall-lös agent). */
  aktivaPaket?: BranschPaketId[];
};

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
  kontext: GranskningsKontext = {},
): Promise<GranskningsUtfall> {
  const flaggor: Flagga[] = [];

  let tenantNamn = kontext.tenantNamn;
  let tenantMall = kontext.tenantMall;
  if (tenantNamn === undefined || tenantMall === undefined) {
    const tenant = await db.query<{ namn: string; mall: string }>(
      `SELECT namn, mall FROM tenants WHERE id = $1`,
      [tenantId],
    );
    tenantNamn ??= tenant.rows[0]?.namn ?? "";
    tenantMall ??= tenant.rows[0]?.mall ?? "";
  }
  const aktivaPaket = kontext.aktivaPaket ?? paketForTenantMall(tenantMall);

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
  // bygg-paketet är aktivt för körningen (mall∩tenant-snittet från
  // anroparen — en mall-lös agent kör inga paketregler). Åberopar
  // fakturan en känd order och beloppet överstiger det kända
  // ordervärdet → needs_review.
  if (aktivaPaket.includes("bygg") && extraktion.order_ref) {
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
    // mot både tidigare förslag och bokförda verifikationer. Beloppet
    // jämförs mot BÅDE debetsumman och största kreditraden
    // (granskningsfynd WP34): vid omvänd byggmoms är debetsumman
    // netto+moms medan dokumentets totalbelopp är netto — leverantörs-
    // skuldraden (största krediten) bär "att betala" i båda formerna.
    const dubblettForslag = await tx.query<{ id: string }>(
      `SELECT id FROM proposals
       WHERE payload->>'motpart' = $1
         AND substring(payload->>'affarshandelsedatum', 1, 7) = $2
         AND status <> 'rejected'
         AND (
           (SELECT coalesce(sum((l->>'debet_ore')::bigint), 0)
            FROM jsonb_array_elements(payload->'lines') l) = $3
           OR
           (SELECT coalesce(max((l->>'kredit_ore')::bigint), 0)
            FROM jsonb_array_elements(payload->'lines') l) = $3
         )`,
      [extraktion.motpart, period, belopp],
    );
    const dubblettVerifikation = await tx.query<{ id: string }>(
      `SELECT v.id FROM verifications v
       JOIN verification_rows r ON r.verification_id = v.id
       WHERE v.motpart = $1 AND to_char(v.affarshandelsedatum, 'YYYY-MM') = $2
       GROUP BY v.id HAVING sum(r.debet_ore) = $3 OR max(r.kredit_ore) = $3`,
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
    // flagga anomaly_amount. INFO-nivå: bokföringen hindras inte
    // ("bokför men notifiera"). Historiken avgränsas till 24 månader —
    // en flerårig huvudbok ska inte läsas i sin helhet per jobb.
    // Sjölva TELEMETRISIGNALEN (audit-händelsen) skrivs av PORTEN när
    // förslaget tas emot (granskningsfynd WP34): där är den atomär med
    // förslaget och idempotent vid kö-omkörning — härifrån hade varje
    // retry lämnat en extra rad i den append-only-loggen.
    const historik = await tx.query<{ belopp: string }>(
      `SELECT sum(r.debet_ore) AS belopp FROM verifications v
       JOIN verification_rows r ON r.verification_id = v.id
       WHERE v.motpart = $1
         AND v.affarshandelsedatum > (now() - interval '24 months')::date
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
          data: {
            belopp_ore: belopp,
            median_ore: med,
            motpart: extraktion.motpart,
            datum: extraktion.datum,
          },
        });
      }
    }
  });

  return { flaggor, eskalera: false, kostnadskontoOverride };
}
