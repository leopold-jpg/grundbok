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
});

export type Extraktion = z.infer<typeof ExtraktionSchema>;
