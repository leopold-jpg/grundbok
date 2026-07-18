import type { ModuleId, ProposalKind, AutonomyPolicy } from "@/contracts";

// Mallregistret (WP11, ADR-0004 + ADR-0005): mallkatalogen är FAST och
// versionerad kod i repot. En agent är en instans av (mall, mallversion) —
// agentraden refererar mallen, den äger aldrig egna instruktioner.
//
// ADR-0005: mallar är FUNKTIONSROLLER, inte branschmallar. Kärnkompetensen
// (mottagarkontroll, kvittomatchning, dubblettdetektering, …) är bransch-
// oberoende; branschspecifika regler bor i BRANSCHPAKET som aktiveras via
// tenant-kontexten. En agent = funktionsmall + tenantens branschpaket +
// tenantens historik. Regel-hemvist (tumregeln ur ADR-0005): gäller regeln
// minst två branscher bor den i mallen; ett paket innehåller ENDAST regler
// som är meningslösa utanför branschen.
//
// AVVIKELSE från ursprungliga kickoff-skissen (kvarstår): MallId är en
// EGEN typ, inte ModuleId. Kontraktets ModuleId ('bokforing', 'loner', …)
// är runtime-förmågan; mallen är den versionerade rollen ovanpå
// ('leverantorsreskontra' är en bokforing-instans). Att vidga ModuleId
// med mall-id:n vore en kontraktsändring utöver mallstämpeln (ADR-0002) —
// mallen pekar i stället ut sin modul via fältet `module`.
//
// Namnkollisionen är medveten och avgränsad: `tenants.mall`/customers/
// mallar är BRANSCHMALLAR (kundconfig — och nyckeln som aktiverar bransch-
// paket, se paketForTenantMall), `policy_mallar` är operatörens
// POLICYMALLAR (DB-rader). Detta register är den enda källan till
// AGENTMALLAR — versionerade hjärnor som går genom PR, test och deploy.

export const MALL_IDS = [
  "bokforing",
  "lon",
  "skatt-compliance",
  "leverantorsreskontra",
] as const;

export type MallId = (typeof MALL_IDS)[number];

export const BRANSCHPAKET_IDS = ["bygg", "restaurang"] as const;

export type BranschPaketId = (typeof BRANSCHPAKET_IDS)[number];

export type MallRegel = {
  id: string;
  beskrivning: string;
  /** Lagrum/regelverk regeln vilar på — blir LegalReference när regeln körs. */
  lagrum?: string;
};

/** Branschpaket (ADR-0005): ett litet, isolerat testbart regelpaket som
 *  aktiveras via tenant-kontexten. Innehåller ENDAST regler som är
 *  meningslösa utanför branschen — allt annat hör hemma i funktionsmallen. */
export type BranschPaket = {
  id: BranschPaketId;
  displayName: string;
  /** Semver — paketet versioneras som mallarna: PR, test, deploy. */
  version: string;
  regler: MallRegel[];
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
  /** Branschpaket mallen KAN aktivera (ADR-0005). Vilka som faktiskt är
   *  aktiva för en agent avgörs av tenant-kontexten — se
   *  aktivaBranschpaket. Utelämnad = rollen är branschneutral. */
  branschpaket?: BranschPaketId[];
  defaultPolicy: PolicyDefaults;
}

const journalEntry: ProposalKind[] = ["journal_entry"];

export const branschpaketRegistret: Record<BranschPaketId, BranschPaket> = {
  bygg: {
    id: "bygg",
    displayName: "Bygg",
    version: "1.0.0",
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
  },

  restaurang: {
    id: "restaurang",
    displayName: "Restaurang",
    version: "1.0.0",
    regler: [
      {
        id: "livsmedelsmoms",
        beskrivning:
          "Livsmedel: tillfälligt sänkt momssats fr.o.m. 2026-04-01 — " +
          "satsen styrs av affärshändelsedatum, inte kvittot.",
        lagrum: "Prop. 2025/26:55",
      },
      {
        id: "kassarapport",
        beskrivning:
          "Kontantförsäljning bokförs per dags-Z-rapport ur certifierat " +
          "kassaregister — aldrig per enskilt kvitto.",
        lagrum: "SFL (2011:1244) 39 kap. 11–12 §§",
      },
    ],
  },
};

export const mallRegistret: Record<MallId, MallDefinition> = {
  bokforing: {
    id: "bokforing",
    module: "bokforing",
    version: "1.0.0",
    displayName: "Bokföring",
    systemPrompt:
      "STUB (release ett): Du är bokföringsagent. Löpande bokföring ur " +
      "underlag: kvittomatchning, periodisering, momshantering. " +
      "Branschregler tillkommer ur tenantens aktiverade branschpaket.",
    regler: [
      {
        id: "kvittomatchning",
        beskrivning:
          "Underlag matchas mot banktransaktion/kortköp innan bokföring — " +
          "varje verifikation ska ha en underlagshänvisning.",
        lagrum: "BFL (1999:1078) 5 kap. 7 §",
      },
      {
        id: "representation",
        beskrivning:
          "Representation: avdragsbegränsning — momsavdrag på underlag upp " +
          "till beloppsgräns, resten kostnadsförs utan avdrag.",
        lagrum: "IL (1999:1229) 16 kap. 2 §",
      },
      {
        id: "periodisering-pagaende-arbeten",
        beskrivning:
          "Pågående arbeten och förutbetalda intäkter periodiseras över " +
          "räkenskapsåret enligt kundens periodiseringsgräns.",
        lagrum: "BFNAR 2017:3 (K2)",
      },
    ],
    branschpaket: ["bygg", "restaurang"],
    // Rutinnivån (f.d. 'Restaurang — standard'): rutinköp upp till
    // 2 000 kr från kända motparter auto-bokförs. Branschpaket kan skärpa
    // via policymallar (t.ex. bygg helt manuell) — förvalet är generiskt.
    defaultPolicy: {
      max_belopp_ore: 200_000,
      min_confidence: 0.85,
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

  "skatt-compliance": {
    id: "skatt-compliance",
    module: "skatt-juridik",
    version: "1.0.0",
    displayName: "Skatt — compliance",
    systemPrompt:
      "STUB (release ett): Du är skatteagent avgränsad till COMPLIANCE: " +
      "deklarationsflöden och periodkontroller. Ingen rådgivning i " +
      "release ett (ADR-0005).",
    regler: [
      {
        id: "momsdeklaration-avstamning",
        beskrivning:
          "Utgående och ingående moms stäms av mot huvudboken innan " +
          "deklarationsunderlag föreslås.",
        lagrum: "SFL (2011:1244) 26 kap.",
      },
      {
        id: "deklarationsfrister",
        beskrivning:
          "Redovisningsperioder och deklarationsfrister bevakas per tenant " +
          "— försenad period flaggas, aldrig auto-hanteras.",
        lagrum: "SFL (2011:1244) 26 kap. 26–30 §§",
      },
    ],
    // Compliance attesteras alltid — inget auto-godkännande alls.
    defaultPolicy: {
      max_belopp_ore: 0,
      min_confidence: 1,
      kanda_motparter_endast: true,
      tillatna_kinds: [],
    },
  },

  leverantorsreskontra: {
    id: "leverantorsreskontra",
    module: "bokforing",
    version: "1.0.0",
    displayName: "Leverantörsreskontra",
    systemPrompt:
      "STUB (release ett): Du är leverantörsreskontra-agent. " +
      "Leverantörsfakturor: mottagarkontroll, dubblettdetektering, " +
      "förskott och betalningsförslag — betalningar verkställs aldrig " +
      "av agenten.",
    regler: [
      {
        id: "mottagarkontroll",
        beskrivning:
          "Betalmottagarens bankgiro/plusgiro verifieras mot känd motpart " +
          "innan ett betalningsförslag läggs — nytt/ändrat konto flaggas.",
      },
      {
        id: "dubblettdetektering",
        beskrivning:
          "Samma motpart + fakturanummer + belopp inom perioden flaggas " +
          "som möjlig dubblett innan bokföring.",
      },
    ],
    branschpaket: ["bygg"],
    // Försiktigare än bokforing-rollen: reskontran rör betalflöden —
    // auto endast under 1 000 kr och med hög konfidens.
    defaultPolicy: {
      max_belopp_ore: 100_000,
      min_confidence: 0.9,
      kanda_motparter_endast: true,
      tillatna_kinds: journalEntry,
    },
  },
};

/** Uppslagning med okänd-id-tålighet: agentrader kan i teorin peka på en
 *  mall som lämnat katalogen (ADR-0004: risk mallversionsdrift) — t.ex.
 *  branschmallarna från före ADR-0005. */
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

// ------------------------------------------------- branschpaket (ADR-0005)

/** Kundconfigens branschmall (tenants.mall: 'bygg', 'cafe', 'konsultbyra',
 *  …) → branschpaketen den aktiverar. Detta är tenant-kontextens
 *  aktiveringsnyckel: branschen väljs aldrig per agent, den härleds ur
 *  tenanten (ADR-0005). Okänd branschmall = inga paket, aldrig ett fel. */
const TENANTMALL_TILL_PAKET: Record<string, BranschPaketId[]> = {
  bygg: ["bygg"],
  cafe: ["restaurang"],
};

export function paketForTenantMall(tenantMall: string): BranschPaketId[] {
  return TENANTMALL_TILL_PAKET[tenantMall] ?? [];
}

/** De paket som faktiskt är aktiva för (funktionsmall, tenant): snittet av
 *  vad mallen kan aktivera och vad tenantens bransch pekar ut. */
export function aktivaBranschpaket(
  mall: MallDefinition,
  tenantMall: string,
): BranschPaket[] {
  const tenantPaket = paketForTenantMall(tenantMall);
  return (mall.branschpaket ?? [])
    .filter((id) => tenantPaket.includes(id))
    .map((id) => branschpaketRegistret[id]);
}

/** Mallens regler + de aktiva paketens regler — den regeluppsättning en
 *  agent faktiskt kör med. Paketregler läggs EFTER mallens (specialisering
 *  läses sist), id-kollisioner är förbjudna via golden-testerna. */
export function effektivaRegler(mall: MallDefinition, tenantMall: string): MallRegel[] {
  return [...mall.regler, ...aktivaBranschpaket(mall, tenantMall).flatMap((p) => p.regler)];
}
