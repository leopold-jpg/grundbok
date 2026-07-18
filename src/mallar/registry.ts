import type { ModuleId, ProposalKind, AutonomyPolicy } from "@/contracts";

// Mallregistret (WP11, ADR-0004): mallkatalogen är FAST och versionerad kod
// i repot. En agent är en instans av (mall, mallversion) — agentraden
// refererar mallen, den äger aldrig egna instruktioner. Kundunikhet bor i
// tenant-kontexten och autonomipolicyn, aldrig här.
//
// AVVIKELSE från kickoff-skissen: MallId är en EGEN typ, inte ModuleId.
// Kontraktets ModuleId ('bokforing', 'loner', …) är runtime-förmågan;
// mallen är den versionerade specialiseringen ovanpå ('bokforing-bygg' är
// en bokforing-instans). Att vidga ModuleId med mall-id:n vore en
// kontraktsändring utöver mallstämpeln (ADR-0002: semver-disciplin på
// schemat) — mallen pekar i stället ut sin modul via fältet `module`.
//
// Namnkollisionen är medveten och avgränsad: `tenants.mall`/customers/
// mallar är BRANSCHMALLAR (kundconfig), `policy_mallar` är operatörens
// POLICYMALLAR (DB-rader). Detta register är den enda källan till
// AGENTMALLAR — versionerade hjärnor som går genom PR, test och deploy.

export const MALL_IDS = [
  "bokforing-bygg",
  "bokforing-restaurang",
  "bokforing-konsult",
  "lon",
] as const;

export type MallId = (typeof MALL_IDS)[number];

export type MallRegel = {
  id: string;
  beskrivning: string;
  /** Lagrum/regelverk regeln vilar på — blir LegalReference när regeln körs. */
  lagrum?: string;
};

/** Mallens förvalda autonomi — kopieras till tenantens autonomy_policies
 *  vid provisionering (samma flöde som operatörens policy_mallar). Kärnans
 *  policyrad förblir enda sanningen; mallen är bara startvärdet. */
export type PolicyDefaults = AutonomyPolicy["auto_approve"];

export interface MallDefinition {
  id: MallId;
  /** Kontraktsmodulen mallen instansierar — mallar vidgar ALDRIG ModuleId. */
  module: ModuleId;
  /** Semver. Agenter pekar på major (ADR-0004): minor/patch följer med
   *  automatiskt vid deploy, ny major kräver migrationssteg. */
  version: string;
  displayName: string;
  /** Release ett: stubb med korrekt struktur — fullt promptinnehåll är
   *  nästa pass, och först då vävs den in i LLM-vägen + prompt_hash. */
  systemPrompt: string;
  regler: MallRegel[];
  defaultPolicy: PolicyDefaults;
}

const journalEntry: ProposalKind[] = ["journal_entry"];

export const mallRegistret: Record<MallId, MallDefinition> = {
  "bokforing-bygg": {
    id: "bokforing-bygg",
    module: "bokforing",
    version: "1.0.0",
    displayName: "Bokföring — bygg",
    systemPrompt:
      "STUB (release ett): Du är bokföringsagent för byggverksamhet. " +
      "Underentreprenader hanteras med omvänd betalningsskyldighet " +
      "(ML 16 kap. 13 §); ROT-underlag särredovisar arbetskostnad.",
    regler: [
      {
        id: "omvand-byggmoms",
        beskrivning:
          "Byggtjänst från underentreprenör: säljaren fakturerar utan moms, " +
          "köparen redovisar ut- och ingående moms (rutor 24/30/48).",
        lagrum: "ML (2023:200) 16 kap. 13 §",
      },
      {
        id: "rot-avdrag",
        beskrivning:
          "ROT-arbeten: arbetskostnad särredovisas från material för " +
          "skattereduktionsunderlaget.",
        lagrum: "IL (1999:1229) 67 kap.",
      },
    ],
    // Speglar policymallen 'Bygg — försiktig': omvänd betalningsskyldighet
    // ska alltid attesteras — inget auto-godkännande alls.
    defaultPolicy: {
      max_belopp_ore: 0,
      min_confidence: 1,
      kanda_motparter_endast: true,
      tillatna_kinds: [],
    },
  },

  "bokforing-restaurang": {
    id: "bokforing-restaurang",
    module: "bokforing",
    version: "1.0.0",
    displayName: "Bokföring — restaurang",
    systemPrompt:
      "STUB (release ett): Du är bokföringsagent för restaurangverksamhet. " +
      "Livsmedel och servering har olika momssatser; representation har " +
      "avdragsbegränsningar.",
    regler: [
      {
        id: "livsmedelsmoms",
        beskrivning:
          "Livsmedel: tillfälligt sänkt momssats fr.o.m. 2026-04-01 — " +
          "satsen styrs av affärshändelsedatum, inte kvittot.",
        lagrum: "Prop. 2025/26:55",
      },
      {
        id: "representation",
        beskrivning:
          "Representation: avdragsbegränsning — momsavdrag på underlag upp " +
          "till beloppsgräns, resten kostnadsförs utan avdrag.",
        lagrum: "IL (1999:1229) 16 kap. 2 §",
      },
    ],
    // Speglar policymallen 'Restaurang — standard': rutinköp upp till
    // 2 000 kr från kända motparter auto-bokförs.
    defaultPolicy: {
      max_belopp_ore: 200_000,
      min_confidence: 0.85,
      kanda_motparter_endast: true,
      tillatna_kinds: journalEntry,
    },
  },

  "bokforing-konsult": {
    id: "bokforing-konsult",
    module: "bokforing",
    version: "1.0.0",
    displayName: "Bokföring — konsult",
    systemPrompt:
      "STUB (release ett): Du är bokföringsagent för konsultverksamhet. " +
      "Tjänsteförsäljning 25 % moms; pågående arbeten periodiseras.",
    regler: [
      {
        id: "tjanstemoms",
        beskrivning: "Konsulttjänster inom Sverige: 25 % moms.",
        lagrum: "ML (2023:200) 9 kap.",
      },
      {
        id: "periodisering-pagaende-arbeten",
        beskrivning:
          "Pågående arbeten och förutbetalda intäkter periodiseras över " +
          "räkenskapsåret enligt kundens periodiseringsgräns.",
        lagrum: "BFNAR 2017:3 (K2)",
      },
    ],
    defaultPolicy: {
      max_belopp_ore: 100_000,
      min_confidence: 0.9,
      kanda_motparter_endast: true,
      tillatna_kinds: journalEntry,
    },
  },

  lon: {
    id: "lon",
    module: "loner",
    version: "1.0.0",
    displayName: "Lön",
    systemPrompt:
      "STUB (release ett): Du är löneagent. Lönekörningar producerar " +
      "payroll_run-förslag: bruttolön, arbetsgivaravgifter, preliminärskatt " +
      "och semesterskuld — alltid som batch med batch_id.",
    regler: [
      {
        id: "agi-redovisning",
        beskrivning:
          "Arbetsgivardeklaration på individnivå (AGI) varje månad — " +
          "lönekörningen ska kunna härledas per anställd.",
        lagrum: "SFL (2011:1244) 26 kap.",
      },
      {
        id: "semesterskuld",
        beskrivning:
          "Intjänad semester skuldförs löpande, inklusive arbetsgivaravgift " +
          "på skulden.",
        lagrum: "Semesterlagen (1977:480)",
      },
    ],
    // Lönekörningar auto-godkänns aldrig i release ett — payroll_run
    // ingår inte i tillåtna kinds.
    defaultPolicy: {
      max_belopp_ore: 0,
      min_confidence: 1,
      kanda_motparter_endast: true,
      tillatna_kinds: [],
    },
  },
};

/** Uppslagning med okänd-id-tålighet: agentrader kan i teorin peka på en
 *  mall som lämnat katalogen (ADR-0004: risk mallversionsdrift). */
export function hamtaMall(id: string): MallDefinition | null {
  return (mallRegistret as Record<string, MallDefinition>)[id] ?? null;
}

/** "1.2.3" → "1" — konventionen agentrader pekar med (ADR-0004). */
export function mallMajor(version: string): string {
  return version.split(".")[0] ?? version;
}

/** Registrets aktuella definition OM dess major matchar agentens pekare —
 *  null är versionsdrift och ska synas i flottöversikten, inte tystas. */
export function hamtaMallForMajor(id: string, major: string): MallDefinition | null {
  const mall = hamtaMall(id);
  if (!mall) return null;
  return mallMajor(mall.version) === major ? mall : null;
}
