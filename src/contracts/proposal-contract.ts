/**
 * Förslagskontraktet — grundbok core v0.2
 * Enda skrivvägen in i kärnan. Alla specialistmoduler (interna eller
 * OpenClaw-agenter hos kund) producerar Proposal och skickar till
 * POST /api/proposals. Endast kärnans beslutsmotor rör huvudboken.
 */

export const CONTRACT_VERSION = "0.2.0" as const;

export type ModuleId =
  | "bokforing"      // kvitto/faktura → kontering (finns, v1)
  | "loner"          // AGI, semesterskuld, arbetsgivaravgifter
  | "skatt-juridik"  // momsfrågor, lagrumsbedömningar
  | "bokslut"        // periodiseringar, K2/K3-justeringar
  | "radgivning";    // BAS/IFRS-frågor — läsande, producerar Answer, ej Proposal

/** Vad agenten föreslår att kärnan gör. */
export type ProposalKind =
  | "journal_entry"      // kontering med debet/kredit-rader
  | "correction"         // rättelsepost (omvända rader, refererar verifikation)
  | "adjustment"         // bokslutsjustering/periodisering
  | "payroll_run"        // lönekörning, batch av journal_entries
  | "advisory_answer";   // svar utan ledger-effekt (rådgivning)

export interface ProposalLine {
  konto: string;             // BAS-konto, t.ex. "2641"
  benamning: string;
  debet_ore: number;         // heltal i ören — aldrig float
  kredit_ore: number;
}

export interface LegalReference {
  lagrum: string;            // "ML (2023:200) 9 kap."
  ruleset: string;           // "se/moms@1.0.0"
  note?: string;
}

/** AI Act / revisionsspårbarhet — obligatoriskt på varje förslag. */
export interface Provenance {
  model: string;             // "claude-opus-4-8"
  prompt_hash: string;       // sha256 av systemprompt + skill-version
  module_version: string;    // semver för modulen
  agent_runtime?: string;    // "openclaw@x.y" om körd via OpenClaw
  input_refs: string[];      // storage-URI:er till kvittobild, mejl, underlag
  injection_screened: boolean;
}

export interface Proposal {
  contract_version: typeof CONTRACT_VERSION;
  id: string;                       // uuid, satt av agenten (idempotensnyckel)
  tenant_id: string;                // klientbolaget — RLS-nyckel
  module: ModuleId;
  kind: ProposalKind;
  batch_id?: string;                // grupperar t.ex. en lönekörning

  affarshandelsedatum: string;      // ISO-datum — styr momssats
  motpart?: string;
  summary: string;                  // en mening, visas i adminkonsolens kö
  lines: ProposalLine[];            // tom för advisory_answer
  legal: LegalReference[];

  confidence: number;               // 0–1, kalibrerad av modulen
  provenance: Provenance;
  hash: string;                     // sha256 av kanoniserad payload — beslutet binds hit
}

/** Kärnans policy — per tenant, modul och kategori. Bor i kärnan, ALDRIG i agenten. */
export interface AutonomyPolicy {
  tenant_id: string;
  module: ModuleId;
  auto_approve: {
    max_belopp_ore: number;         // t.ex. 500_000 = 5 000 kr
    min_confidence: number;         // t.ex. 0.95
    kanda_motparter_endast: boolean;
    tillatna_kinds: ProposalKind[]; // correction kräver t.ex. alltid människa
  };
  /** Allt som inte matchar auto_approve hamnar i godkännandekön. */
}

export type DecisionOutcome = "auto_approved" | "approved" | "rejected";

/** Kärnans svar — det enda som kan resultera i en ledger-skrivning. */
export interface Decision {
  proposal_id: string;
  proposal_hash: string;            // måste matcha — annars vägrar kärnan
  outcome: DecisionOutcome;
  decided_by: string;               // konsultens identitet eller "policy:<policy_id>"
  decided_at: string;               // ISO timestamp
  verifikationsnummer?: number;     // löpnummer, sätts av kärnan vid bokföring
  reason?: string;                  // obligatorisk vid rejected
}

/**
 * Modulmanifest — det en modul registrerar mot kärnan.
 * Adminkonsolen renderar sin modulvy från detta.
 */
export interface ModuleManifest {
  id: ModuleId;
  version: string;
  produces: ProposalKind[];
  requires_scopes: ("proposals:write" | "ledger:read" | "documents:read")[];
  human_oversight_default: boolean; // AI Act: default true, policy kan lätta
  /** Stripe-förberedelse (WP10): prisreferens för self-service-köp av
   *  agenten. null tills billing finns — ingen Stripe-integration i v0.2. */
  price_ref?: string | null;
}
