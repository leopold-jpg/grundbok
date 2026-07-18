import { MALL_IDS, type MallId } from "./registry";

// AgentDraft (kompletteringspass efter WP27): fri beskrivning i
// provisioneringens steg 2 → förslag på (funktionsroll, agentnamn).
// REGELBASERAD nyckelordsmatchning mot mallregistret — ingen LLM, inga
// nätverksanrop: operatörens inmatning lämnar aldrig processen och
// samma beskrivning ger alltid samma förslag.

export type AgentDraftForslag = {
  mallId: MallId;
  /** Namnförslag i agentnamn-stil (jfr platshållaren "kvittoagent-butik-2"):
   *  rollen + första betydelsebärande ordet ur beskrivningen. */
  namn: string;
};

/** Nyckelord per roll, viktade: en specifik rolls kärnord (leverantör,
 *  reskontra, lön…) väger tyngre än basrollens breda ord, så "bokför våra
 *  leverantörsfakturor" landar i reskontran, inte basrollen. Vid exakt
 *  lika poäng vinner först-deklarerad roll i MALL_IDS — medvetet: en
 *  tvetydig beskrivning ("fakturor och kvitton") föreslår breda
 *  bokforing-rollen, och testerna låser det. */
const NYCKELORD: Record<MallId, { ord: RegExp; vikt: number }[]> = {
  bokforing: [
    { ord: /bokfor/, vikt: 1 },
    { ord: /kvitto/, vikt: 2 },
    { ord: /verifikat/, vikt: 2 },
    { ord: /lopande/, vikt: 1 },
  ],
  lon: [
    // Fristående ord (lön/löner/lönen/lönerna) OCH sammansättningar på
    // löne- (lönebetalningar, lönehantering, löneadministration …) —
    // granskningsfynd: enbart \b-ankringen missade sammansättningarna.
    { ord: /\blon(er|erna|en)?\b/, vikt: 3 },
    { ord: /lone[a-z]/, vikt: 3 },
    { ord: /payroll/, vikt: 3 },
    { ord: /anstallda?/, vikt: 2 },
    { ord: /semester/, vikt: 2 },
    { ord: /arbetsgivaravgift/, vikt: 3 },
  ],
  "skatt-compliance": [
    { ord: /skatt/, vikt: 3 },
    { ord: /deklaration/, vikt: 3 },
    { ord: /\bmoms/, vikt: 2 },
    { ord: /compliance/, vikt: 3 },
    { ord: /periodkontroll/, vikt: 3 },
  ],
  leverantorsreskontra: [
    { ord: /leverantor/, vikt: 3 },
    { ord: /reskontra/, vikt: 3 },
    { ord: /faktur/, vikt: 2 },
    { ord: /betalning/, vikt: 2 },
    { ord: /dubblett/, vikt: 2 },
  ],
};

/** Småord + rollord som inte duger som namnled — resten av beskrivningen
 *  får ge namnets andra halva ("bokföring för min byggfirma" → byggfirma). */
const STOPPORD = new Set([
  "for", "min", "mitt", "mina", "var", "vart", "vara", "era",
  "deras", "och", "eller", "till", "med", "utan", "hos", "fran", "det",
  "den", "de", "en", "ett", "att", "som", "pa", "av", "i", "vi", "jag",
  "har", "ska", "skall", "behover", "vill", "hjalp", "skota", "skoter",
  "hantera", "hanterar", "at", "ab", "varje", "alla", "hela", "nya",
  "manad", "manaden", "manader", "vecka", "veckan", "dag", "dagen",
  "ar", "aret",
]);

/** Svensk lågnormalisering: gemener + åäö → a/a/o, övrigt oförändrat.
 *  Både nyckelord och namnled matchas i denna form. */
function normalisera(text: string): string {
  return text
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e");
}

/** Betydelsebärande namnled ur beskrivningen: första ordet som varken är
 *  stoppord eller nyckelord för NÅGON roll — "bokföra kvitton och
 *  leverantörsfakturor" ska ge -agent-fallbacken, inte "…-bokfora"
 *  (granskningsfynd: att bara undanta vinnarrollens ord släppte igenom
 *  de andra rollernas). Enbokstavsord är aldrig namnled; tvåbokstavsord
 *  ("ab") filtreras via stopporden. */
function namnled(ord: string[]): string | null {
  for (const o of ord) {
    if (o.length < 2 || STOPPORD.has(o)) continue;
    if (MALL_IDS.some((m) => NYCKELORD[m].some((n) => n.ord.test(o)))) continue;
    return o.slice(0, 24);
  }
  return null;
}

/**
 * Regelbaserat förslag ur fri beskrivning ("bokföring för min byggfirma").
 * null när inget nyckelord träffar — steget förmarkerar aldrig en roll på
 * gissning, operatören väljer själv.
 */
export function foreslaAgentDraft(beskrivning: string): AgentDraftForslag | null {
  const text = normalisera(beskrivning);
  const ord = text.split(/[^a-z0-9]+/).filter(Boolean);
  if (ord.length === 0) return null;

  let bast: { mallId: MallId; poang: number } | null = null;
  for (const mallId of MALL_IDS) {
    const poang = NYCKELORD[mallId].reduce(
      (sum, n) => (n.ord.test(text) ? sum + n.vikt : sum),
      0,
    );
    // Strikt större: vid lika poäng vinner först-deklarerad roll — dvs.
    // breda bokforing-basrollen vid tvetydig beskrivning (se NYCKELORD-
    // kommentaren; testerna låser tie-breaken).
    if (poang > 0 && (!bast || poang > bast.poang)) bast = { mallId, poang };
  }
  if (!bast) return null;

  const led = namnled(ord);
  return { mallId: bast.mallId, namn: led ? `${bast.mallId}-${led}` : `${bast.mallId}-agent` };
}
