import { CORPUS, type Chunk } from "./corpus";

// Deterministisk lexikal retrieval. Det finns ingen embedding-tjänst i
// stacken (och rådgivningen ska fungera offline i fallback-läget), så
// sökningen är ren termöverlappning med idf-viktning — samma fråga mot
// samma korpusversion ger ALLTID samma träffar, vilket gör svaren
// reproducerbara mot provenance-stämpeln.

export type Traff = { chunk: Chunk; poang: number };

/** BAS-kontonummer: fyra siffror, kontoklass 1–8 (samma regex som kontraktet). */
const KONTO_RE = /^[1-8]\d{3}$/;

// Minimal svensk stopordslista — bara funktionsord som aldrig diskriminerar
// mellan chunks. Domänord ("moms", "konto", "saldo") får ALDRIG stå här.
const STOPPORD = new Set([
  "och", "att", "som", "för", "på", "är", "det", "den", "de", "en", "ett",
  "av", "med", "till", "om", "i", "ur", "vid", "kan", "ska", "skall", "man",
  "vad", "hur", "vilken", "vilket", "vilka", "när", "var", "vem", "inte",
  "eller", "också", "har", "hade", "får", "än", "så", "sin", "sitt", "sina",
  "min", "mitt", "mina", "här", "där", "detta", "denna", "dessa", "används",
  "gäller", "finns", "står", "blir", "vara",
]);

/**
 * Tokenisering för svenska: gemener, split på icke-alfanumeriskt (å/ä/ö
 * behålls). Siffertokens behålls avsiktligt — 4-siffriga BAS-kontonummer
 * ("2641") ska vara exakta, sökbara termer och inte normaliseras bort.
 */
export function tokenisera(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9åäö]+/)
    .filter((t) => t.length >= 2);
}

type IndexPost = {
  chunk: Chunk;
  tokens: Set<string>;
  tokenLista: string[]; // för prefixmatchning ("momssats" → "momssatser")
  antal: number; // total tokenlängd — för längdnormalisering
  lagrumTokens: Set<string>;
};

// Index byggs en gång vid laddning — korpusen är statisk per process.
const INDEX: IndexPost[] = CORPUS.map((chunk) => {
  const alla = tokenisera(`${chunk.rubrik} ${chunk.text}`);
  const tokens = new Set(alla);
  return {
    chunk,
    tokens,
    tokenLista: [...tokens],
    antal: alla.length,
    lagrumTokens: new Set(chunk.lagrum.flatMap((l) => tokenisera(l))),
  };
});

// Dokumentfrekvens per token → idf. Vanliga ord ("moms" finns i nästan
// varje chunk) väger lätt; ovanliga ord väger tungt.
const DF = new Map<string, number>();
for (const post of INDEX) {
  for (const t of post.tokens) DF.set(t, (DF.get(t) ?? 0) + 1);
}
const N = INDEX.length;

function idf(token: string): number {
  return Math.log(1 + N / ((DF.get(token) ?? 0) + 0.5));
}

/**
 * Poängsätter alla chunks mot frågan och returnerar topp-N (default 4).
 *
 * Poängmodell (deterministisk, dokumenterad för reproducerbarhet):
 * - exakt termträff: + idf(term)
 * - prefixträff (term ≥ 5 tecken, böjningsformer): + idf(term) / 2
 * - exakt kontonummerträff (t.ex. "2641" i både fråga och chunk): + 4
 * - lagrumsträff (siffertoken ur frågan, t.ex. "2025/26:55" → "2025",
 *   som finns i chunkens lagrumsreferenser): + 2
 * - längdnormalisering: dividera med log2(tokenlängd + 4) så att precisa
 *   chunks slår långa sektioner som råkar innehålla allt.
 * Ties bryts på chunk-id för total determinism.
 */
export function sokKorpus(fraga: string, topN = 4): Traff[] {
  const qTokens = [...new Set(tokenisera(fraga))].filter((t) => !STOPPORD.has(t));
  if (qTokens.length === 0) return [];

  const traffar: Traff[] = [];
  for (const post of INDEX) {
    let poang = 0;
    for (const t of qTokens) {
      if (post.tokens.has(t)) {
        poang += idf(t);
        if (KONTO_RE.test(t)) poang += 4;
      } else if (t.length >= 5 && post.tokenLista.some((k) => k.startsWith(t))) {
        poang += idf(t) / 2;
      }
      if (/\d/.test(t) && post.lagrumTokens.has(t)) poang += 2;
    }
    if (poang <= 0) continue;
    traffar.push({ chunk: post.chunk, poang: poang / Math.log2(post.antal + 4) });
  }

  traffar.sort(
    (a, b) => b.poang - a.poang || a.chunk.id.localeCompare(b.chunk.id, "sv"),
  );
  return traffar.slice(0, topN);
}
