import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, sha256Hex } from "@/contracts";
import { loadKonteringRules, loadMomsRules } from "@/lib/skills";

// Rådgivningsmodulens kunskapskorpus byggs vid laddning ur repots EGNA
// källor (MIT-licensierat innehåll i skills/): varje skills/se/*/SKILL.md
// chunkas per ##-sektion, och rules.json-reglerna blir syntetiska,
// retrieval-vänliga chunks (momssatser med giltighetsintervall, kontotabell,
// omvänd betalningsskyldighet). Ingen extern korpus, inga nätverkskällor —
// samma princip som regelmotorn: versionerad data i repot är sanningen,
// och CORPUS_VERSION gör varje svar spårbart till exakt det innehåll som
// gällde när svaret gavs (stämplas in i provenance.prompt_hash).

const REPO_ROOT = process.cwd();

export type Chunk = {
  /** Stabilt id, t.ex. "se/moms#regler" eller "se/moms#momssatser-rules". */
  id: string;
  /** Skill-id = katalognamnet under skills/, samma id som rules.json använder. */
  skill: string;
  /** Version ur SKILL.md-frontmattern respektive rules.json. */
  version: string;
  rubrik: string;
  text: string;
  /** Lagrumsreferenser i chunken — driver retrieval-boost och svarets legal[]. */
  lagrum: string[];
  kalla: "skill_md" | "rules_json";
};

// Svenska lagrumsmönster som förekommer i skills-biblioteket:
// "ML (2023:200) 16 kap. 13 §", "ML 9 kap.", "SFL (2011:1244) 26 kap. 10–11 §§",
// "BFL (1999:1078) 5 kap. 7 §", "BFNAR 2016:10 punkt 2.4", "prop. 2025/26:55".
const LAGRUM_RE = new RegExp(
  [
    // Lag med SFS-nummer, ev. följt av kapitel och paragraf(er)
    String.raw`\b(?:ML|SFL|BFL|ABL|BrB)\s*\(?\d{4}:\d+\)?(?:\s+\d+\s+kap\.(?:\s+\d+(?:\s*[–-]\s*\d+)?\s*§§?)?)?`,
    // Lag utan utskrivet SFS-nummer men med kapitelreferens
    String.raw`\b(?:ML|SFL|BFL|ABL|BrB)\s+\d+\s+kap\.(?:\s+\d+(?:\s*[–-]\s*\d+)?\s*§§?)?`,
    // BFN:s allmänna råd
    String.raw`\bBFNAR\s+\d{4}:\d+(?:\s+punkt\s+[\d.]+)?`,
    // Förarbeten
    String.raw`\bprop\.\s*\d{4}/\d{2}:\d+`,
  ].join("|"),
  "g",
);

export function extraheraLagrum(text: string): string[] {
  const traffar = text.match(LAGRUM_RE) ?? [];
  return [...new Set(traffar.map((t) => t.trim().replace(/[.,;]$/, "")))];
}

/** Minimal frontmatter-läsning — vi behöver bara version + brödtexten. */
function parseFrontmatter(md: string): { version: string; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return { version: "0.0.0", body: md };
  const v = m[1].match(/^version:\s*["']?([\w.-]+)/m);
  return { version: v?.[1] ?? "0.0.0", body: md.slice(m[0].length) };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9åäö]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Chunkar en SKILL.md per ##-sektion; texten före första ## blir "Inledning". */
function chunkaSkillMd(skillId: string, md: string): Chunk[] {
  const { version, body } = parseFrontmatter(md);
  const chunks: Chunk[] = [];
  for (const del of body.split(/\n(?=## )/)) {
    const text = del.trim();
    if (text.length < 40) continue; // rubriklösa rester och avslutande streck
    const rubrik = text.startsWith("## ")
      ? (text.match(/^##\s+(.+)$/m)?.[1] ?? "Avsnitt").trim()
      : "Inledning";
    chunks.push({
      id: `${skillId}#${slug(rubrik)}`,
      skill: skillId,
      version,
      rubrik,
      text,
      lagrum: extraheraLagrum(text),
      kalla: "skill_md",
    });
  }
  return chunks;
}

function laddaSkillMdChunks(): Chunk[] {
  const rot = join(REPO_ROOT, "skills", "se");
  const chunks: Chunk[] = [];
  // Sorterat för deterministisk korpusordning (CORPUS_VERSION ska vara stabil).
  for (const namn of readdirSync(rot).sort()) {
    const skillMd = join(rot, namn, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    chunks.push(...chunkaSkillMd(`se/${namn}`, readFileSync(skillMd, "utf8")));
  }
  return chunks;
}

/**
 * Syntetiska chunks ur skills/se/moms/rules.json — samma data som den
 * deterministiska regelmotorn exekverar, omskriven till retrieval-vänlig
 * löptext så att lexikal sökning träffar den.
 */
function momsRuleChunks(): Chunk[] {
  const r = loadMomsRules();
  const bas = { skill: r.skill, version: r.version, kalla: "rules_json" as const };

  // 1. Momssatser med giltighetsintervall + lagrum. Intervallen är poängen:
  //    satsen bestäms av affärshändelsens datum, inte av en konstant.
  const satsRader: string[] = [
    "Momssatser (moms, mervärdesskatt, momssats, skattesats) per kategori.",
    "Satsen väljs efter affärshändelsens datum mot giltighetsintervallen:",
  ];
  const satsLagrum = new Set<string>();
  for (const [nyckel, kategori] of Object.entries(r.kategorier)) {
    for (const p of kategori.satser) {
      const giltighet =
        p.from || p.to ? `${p.from ?? "tidigare"} – ${p.to ?? "tills vidare"}` : "tills vidare";
      satsRader.push(
        `- ${kategori.label} (${nyckel}): ${p.sats} % (giltighet: ${giltighet}) — ${p.lagrum}`,
      );
      satsLagrum.add(p.lagrum);
    }
  }
  for (const [alias, mal] of Object.entries(r.kategorialias)) {
    const sats = r.kategorier[mal]?.satser.find((p) => !p.from && !p.to)?.sats ?? 25;
    satsRader.push(`- Kategorin ${alias} följer ${mal}: ${sats} %.`);
  }

  // 2. Momskontotabellen. "Lagrum" här är källhänvisningen till officiella
  //    BAS-tabellen — kontovalet är konvention (bas.se), inte lagtext.
  const k = r.konton;
  const kontoText = [
    "Momskonton enligt officiella BAS 2025-kontotabellen (bas.se):",
    `- Utgående moms 25 % bokförs på konto ${k.utgaende["25"]}.`,
    `- Utgående moms 12 % bokförs på konto ${k.utgaende["12"]}.`,
    `- Utgående moms 6 % bokförs på konto ${k.utgaende["6"]}.`,
    `- Ingående moms bokförs ALLTID på konto ${k.ingaende} (Debiterad ingående moms) — kontot delas inte upp per sats.`,
    `- Omvänd betalningsskyldighet: utgående moms 25 % på konto ${k.omvand.utgaende_25}, ingående moms på konto ${k.omvand.ingaende}.`,
    "- Konto 2617 finns inte i officiella BAS (programvarukonvention) och ska inte föreslås.",
  ].join("\n");

  // 3. Omvänd betalningsskyldighet i byggsektorn.
  const bygg = r.omvand_betalningsskyldighet.bygg;
  const byggText = [
    `Omvänd betalningsskyldighet för byggtjänster (byggmoms, omvänd byggmoms) — ${bygg.lagrum}:`,
    `- Villkor: ${bygg.villkor}`,
    `- Säljaren fakturerar utan moms; köparen redovisar utgående moms ${bygg.sats} % på konto ${k.omvand.utgaende_25} och ingående moms på konto ${k.omvand.ingaende}. Kostnadskonto: ${bygg.kostnadskonto}.`,
    `- Momsdeklarationens rutor: ${bygg.deklarationsrutor.underlag} (underlag), ${bygg.deklarationsrutor.utgaende} (utgående moms), ${bygg.deklarationsrutor.ingaende} (ingående moms).`,
    "- Nettoeffekt noll vid full avdragsrätt.",
  ].join("\n");

  return [
    {
      ...bas,
      id: `${r.skill}#momssatser-rules`,
      rubrik: "Momssatser med giltighetsintervall (rules.json)",
      text: satsRader.join("\n"),
      lagrum: [...satsLagrum],
    },
    {
      ...bas,
      id: `${r.skill}#momskonton-rules`,
      rubrik: "Momskonton (rules.json)",
      text: kontoText,
      lagrum: ["BAS 2025-kontotabellen (bas.se)"],
    },
    {
      ...bas,
      id: `${r.skill}#omvand-betalningsskyldighet-rules`,
      rubrik: "Omvänd betalningsskyldighet bygg (rules.json)",
      text: byggText,
      lagrum: [bygg.lagrum],
    },
  ];
}

/** Syntetisk kontotabell ur skills/se/bas-kontering/rules.json. */
function konteringRuleChunks(): Chunk[] {
  const r = loadKonteringRules();
  const rader: string[] = [
    "Kontotabell för kontering enligt BAS 2025 (bas.se):",
    "Motkonton:",
  ];
  for (const [nyckel, mot] of Object.entries(r.motkonton)) {
    rader.push(`- ${nyckel}: konto ${mot.konto} ${mot.namn}.`);
  }
  rader.push("Kostnadskonton per kategori:");
  for (const [kategori, konto] of Object.entries(r.kostnadskonton)) {
    rader.push(
      `- ${kategori}: konto ${konto.konto} ${konto.namn}.${konto.not ? ` (${konto.not})` : ""}`,
    );
  }
  return [
    {
      id: `${r.skill}#kontotabell-rules`,
      skill: r.skill,
      version: r.version,
      rubrik: "Kontotabell (rules.json)",
      text: rader.join("\n"),
      lagrum: ["BAS 2025-kontotabellen (bas.se)"],
      kalla: "rules_json",
    },
  ];
}

function byggKorpus(): Chunk[] {
  return [...laddaSkillMdChunks(), ...momsRuleChunks(), ...konteringRuleChunks()];
}

/** Korpusen byggs en gång vid laddning — källfilerna ändras inte i runtime. */
export const CORPUS: Chunk[] = byggKorpus();

/**
 * sha256 av korpusinnehållet (kanoniserad JSON av samtliga chunks).
 * Ingår i provenance.prompt_hash så att varje advisory_answer kan spåras
 * till exakt den kunskapsversion som producerade det.
 */
export const CORPUS_VERSION: string = sha256Hex(canonicalJson(CORPUS));
