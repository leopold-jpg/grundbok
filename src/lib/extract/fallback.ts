import { KATEGORIER, type Extraktion } from "./schema";

// Deterministisk fallback-tolkning: samma schema som Anthropic-vägen,
// noll nätverksberoende. Faller demon tillbaka hit fortsätter flödet
// oförändrat — regelmotorn bryr sig inte om vem som tolkade.
// Regexbaserad och medvetet enkel: den ska klara demons exempeldokument
// felfritt och vanliga svenska kvitton hyggligt.

const KATEGORI_NYCKELORD: [RegExp, (typeof KATEGORIER)[number]][] = [
  [/kaffe|livsmedel|matvaror|mjölk|bröd|råvaror|bönor/i, "livsmedel"],
  [/restaurang|catering|servering|lunch|middag/i, "restaurang_catering"],
  [/hotell|logi|övernattning/i, "hotell"],
  [/bygg|entreprenad|anläggning|installation|underentreprenör|mark-|grundarbete/i, "byggtjanst"],
  [/kontorsmaterial|papper|pennor|toner/i, "kontorsmaterial"],
  [/programvara|licens|saas|it-tjänst|hosting|molntjänst/i, "it_tjanster"],
  [/bok|böcker|tidning|tidskrift/i, "bocker_tidningar"],
  [/taxi|tåg|buss|flyg|resa|sj\b/i, "persontransport"],
];

/** "1 234,56" / "1234.56" / "1 234" → ören (heltal). */
function parseOre(s: string): number {
  const norm = s
    .replace(/[\s  ]/g, "")
    .replace(/kr|SEK/gi, "")
    .replace(",", ".");
  const n = Number.parseFloat(norm);
  if (!Number.isFinite(n)) throw new Error(`Kunde inte tolka belopp: "${s}"`);
  return Math.round(n * 100);
}

const BELOPP = String.raw`([\d\s  ]+(?:[.,]\d{1,2})?)`;

function hittaBelopp(text: string, etiketter: RegExp[]): number | null {
  for (const etikett of etiketter) {
    const re = new RegExp(etikett.source + String.raw`[^\d\n]*` + BELOPP, "i");
    const m = text.match(re);
    if (m) {
      try {
        return parseOre(m[1]);
      } catch {
        continue;
      }
    }
  }
  return null;
}

export function tolkaMedFallback(text: string): Extraktion {
  const datum =
    text.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ??
    new Date().toISOString().slice(0, 10);

  // Motpart: rad märkt "Från/Leverantör", annars första icke-tomma raden
  // som inte är ett dokumenttypsord (FAKTURA/KVITTO/RÄKNING).
  const motpart =
    text.match(/(?:från|leverantör|säljare)\s*[:.]\s*(.+)/i)?.[1]?.trim() ??
    text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !/^(faktura|kvitto|räkning)\b/i.test(l))[0] ??
    "Okänd motpart";

  const netto = hittaBelopp(text, [/netto(?:belopp)?/, /belopp\s+exkl\.?\s*moms/, /summa\s+exkl\.?\s*moms/]);
  const moms = hittaBelopp(text, [/moms(?:\s*\(\d+\s*%\))?/, /varav\s+moms/]);
  const brutto = hittaBelopp(text, [/att\s+betala/, /totalt?/, /summa(?!\s+exkl)/, /brutto/]);

  const momssats = text.match(/moms\s*\(?\s*(\d{1,2})\s*%/i)?.[1];

  let netto_ore = netto;
  if (netto_ore === null && brutto !== null && moms !== null) netto_ore = brutto - moms;
  if (netto_ore === null && brutto !== null) netto_ore = brutto;
  if (netto_ore === null) {
    throw new Error("Fallback-tolkningen hittade inget belopp i dokumentet");
  }

  let kategori: (typeof KATEGORIER)[number] = "ovrigt";
  for (const [re, kat] of KATEGORI_NYCKELORD) {
    if (re.test(text)) {
      kategori = kat;
      break;
    }
  }

  const beskrivningsrad = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /avser|gäller|beskrivning/i.test(l));

  return {
    motpart: motpart.slice(0, 120),
    beskrivning:
      beskrivningsrad?.replace(/^(avser|gäller|beskrivning)\s*[:.]\s*/i, "").slice(0, 200) ??
      `Inköp från ${motpart.slice(0, 80)}`,
    datum,
    netto_ore,
    moms_ore: moms,
    brutto_ore: brutto,
    momssats_angiven: momssats ? Number(momssats) : null,
    kategori,
    betalsatt: /faktura|förfallodag|bankgiro|att\s+betala/i.test(text) ? "faktura" : "direkt",
  };
}
