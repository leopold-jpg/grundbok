import { z } from "zod";

// Extraktionsschemat — samma schema för riktig LLM och deterministisk
// fallback (utbytbarheten är poängen). Kategorierna är enum-låsta:
// LLM:en kan inte hitta på konteringsbara kategorier (TaxHacker-läxan,
// se ATTRIBUTION.md). Belopp i ören som heltal — svenska kvitton
// använder decimalkomma och parseFloat är en fälla.

export const KATEGORIER = [
  "livsmedel",
  "restaurang_catering",
  "hotell",
  "bocker_tidningar",
  "persontransport",
  "kultur_idrott",
  "kontorsmaterial",
  "it_tjanster",
  "byggtjanst",
  "ovrigt",
] as const;

export const ExtraktionSchema = z.object({
  motpart: z.string().describe("Leverantören/motparten, t.ex. företagsnamnet på fakturan"),
  beskrivning: z.string().describe("Kort beskrivning av vad affärshändelsen avser"),
  datum: z
    .string()
    .describe("Affärshändelsens datum i formatet YYYY-MM-DD (fakturadatum/kvittodatum)"),
  netto_ore: z
    .number()
    .int()
    .describe("Nettobelopp exklusive moms, i ören (heltal). 1 000,00 kr = 100000"),
  moms_ore: z
    .number()
    .int()
    .nullable()
    .describe("Momsbelopp i ören om det anges på dokumentet, annars null"),
  brutto_ore: z
    .number()
    .int()
    .nullable()
    .describe("Totalbelopp inklusive moms i ören om det anges, annars null"),
  momssats_angiven: z
    .number()
    .nullable()
    .describe("Momssats i procent om den anges på dokumentet (25, 12 eller 6), annars null"),
  kategori: z
    .enum(KATEGORIER)
    .describe(
      "Affärshändelsens kategori. livsmedel=matvaror/råvaror; restaurang_catering=servering; byggtjanst=bygg-/anläggningstjänster; ovrigt om inget passar",
    ),
  betalsatt: z
    .enum(["faktura", "direkt"])
    .describe("faktura = leverantörsfaktura att betala senare; direkt = betalt på plats (kort/swish)"),

  // ---- Observationsfält (WP32): LLM:en/fallbacken RAPPORTERAR vad
  // dokumentet säger — den deterministiska granskningen (granskning.ts)
  // fattar besluten (flaggor, eskalering, kontoval). Alla fält har
  // default så att äldre payloads och testliteraler validerar oförändrat.
  mottagare: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "Vem dokumentet är STÄLLT TILL (fakturamottagare/köpare) om det framgår — inte leverantören. Annars null",
    ),
  forskott: z
    .boolean()
    .default(false)
    .describe(
      "true om dokumentet är en förskottsfaktura/a conto/deposition — betalning FÖRE leverans, inte en kostnad ännu",
    ),
  privat_indikation: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "Om innehållet framstår som privat/verksamhetsfrämmande: kort motivering (t.ex. 'privat middag'). Annars null",
    ),
  order_ref: z
    .string()
    .nullable()
    .default(null)
    .describe("Order-/beställningsreferens som dokumentet åberopar (t.ex. 'ORD-2026-77'), annars null"),
  rest_utan_underlag_ore: z
    .number()
    .int()
    .nullable()
    .default(null)
    .describe(
      "Belopp i ören som enligt dokumentet SAKNAR kvitto/underlag (t.ex. 'varav utan kvitto: 400,00 kr'), annars null",
    ),
});

export type Extraktion = z.infer<typeof ExtraktionSchema>;

/** Neutralvärden för observationsfälten (WP32) — för testliteraler och
 *  äldre anropare som bygger Extraktion för hand. */
export const OBSERVATIONS_DEFAULTS: Pick<
  Extraktion,
  "mottagare" | "forskott" | "privat_indikation" | "order_ref" | "rest_utan_underlag_ore"
> = {
  mottagare: null,
  forskott: false,
  privat_indikation: null,
  order_ref: null,
  rest_utan_underlag_ore: null,
};
