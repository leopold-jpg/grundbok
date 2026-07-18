import { randomUUID } from "node:crypto";
import {
  CONTRACT_VERSION,
  hashProposal,
  sha256Hex,
  type Proposal,
  type LegalReference,
} from "@/contracts";
import type { Flagga, Forslag } from "./kontering";
import type { Extraktion } from "./extract/schema";

// Modul #1: bokforing — v1:s kvitto/faktura-tolkning bakom förslags-
// kontraktet (ADR-0002, arbetspaket 3). Tolkning + regelmotor producerar
// en Proposal som går genom exakt samma port (handleProposal) som externa
// agenter. Modulen bestämmer aldrig sin egen autonomi — det gör kärnans
// policy.

export const BOKFORING_MODULE_VERSION = "0.2.0";

/**
 * Kalibrerad-nog konfidens för v0.2: riktig LLM-tolkning är säkrare än
 * regex-fallbacken, och varningsflaggor (t.ex. momssats_avviker) ska
 * trycka förslaget till godkännandekön även under en generös policy.
 */
export function bokforingsKonfidens(
  motor: "anthropic" | "fallback",
  forslag: Forslag,
): number {
  const bas = motor === "anthropic" ? 0.9 : 0.7;
  const harVarning = forslag.flaggor.some((f) => f.niva === "varning");
  return Math.max(0.3, harVarning ? bas - 0.25 : bas);
}

export function byggBokforingsProposal(input: {
  tenantId: string;
  documentId: string;
  extraktion: Extraktion;
  forslag: Forslag;
  motor: "anthropic" | "fallback";
  motorDetalj: string;
  /** Deterministiskt id (uuid v5 av job_id) när workern bygger — idempotens. */
  id?: string;
  /** Sätts av runtime-lagret (t.ex. "worker-lokal@0.2") — skiljer körningar i beslutsloggen. */
  agentRuntime?: string;
  /** Mallstämpeln (v0.3, ADR-0004): agentens mall + registrets exakta
   *  version. Utelämnad för mall-lösa körningar (intag-UI, äldre agenter). */
  mall?: { id: string; version: string };
  /** Den kompletta systemprompt körningen använde (WP31) — ingår i
   *  prompt_hash så att branschpaketändringar syns i provenansen. */
  systemPrompt?: string;
}): Proposal {
  const { forslag } = input;

  const legal: LegalReference[] = [
    {
      lagrum: forslag.moms.lagrum,
      ruleset: `se/moms@${forslag.skill_versions["se/moms"]}`,
    },
    {
      lagrum: "BAS 2025 (officiell kontotabell, bas.se)",
      ruleset: `se/bas-kontering@${forslag.skill_versions["se/bas-kontering"]}`,
    },
  ];

  const utanHash: Omit<Proposal, "hash"> = {
    contract_version: CONTRACT_VERSION,
    id: input.id ?? randomUUID(),
    tenant_id: input.tenantId,
    module: "bokforing",
    kind: "journal_entry",
    // Conditional spread, inte `mall_id: undefined` — canonicalJson
    // serialiserar en satt-men-undefined nyckel och hashen skulle glida
    // isär mot en agent som utelämnar fälten.
    ...(input.mall ? { mall_id: input.mall.id, mall_version: input.mall.version } : {}),
    affarshandelsedatum: forslag.affarshandelsedatum,
    motpart: input.extraktion.motpart,
    summary: input.extraktion.beskrivning.slice(0, 300),
    lines: forslag.rader.map((r) => ({
      konto: r.konto,
      benamning: r.kontonamn,
      debet_ore: r.debet_ore,
      kredit_ore: r.kredit_ore,
    })),
    legal,
    confidence: bokforingsKonfidens(input.motor, forslag),
    provenance: {
      ...(input.agentRuntime ? { agent_runtime: input.agentRuntime } : {}),
      model: input.motor === "anthropic" ? input.motorDetalj : "fallback:deterministisk",
      // prompt_hash täcker modulversion + skillversioner + (när mallen
      // körs, WP31) hela den sammanvävda systemprompten — ett bumpat
      // branschpaket ger nytt hash och syns i revisionsspåret.
      prompt_hash: sha256Hex(
        `grundbok-bokforing@${BOKFORING_MODULE_VERSION}|` +
          JSON.stringify(forslag.skill_versions) +
          (input.systemPrompt ? `|prompt:${sha256Hex(input.systemPrompt)}` : ""),
      ),
      module_version: BOKFORING_MODULE_VERSION,
      input_refs: [`document:${input.documentId}`],
      injection_screened: true, // tolka-routen screenar dokumentet före LLM
    },
  };

  return { ...utanHash, hash: hashProposal(utanHash) };
}

/** Eskalering utan kontering (WP32): mottagarkontrollen eller privat-
 *  vakten föll — förslaget byggs som advisory_answer (inga rader, ingen
 *  ledger-effekt, kontrakt v0.3) och går till granskningskön. Kontraktet
 *  kräver rader för journal_entry, så "ingen kontering" ÄR advisory-
 *  formen — aldrig ett halvtomt journal_entry. */
export function byggEskaleringsProposal(input: {
  tenantId: string;
  documentId: string;
  extraktion: Extraktion;
  skal: string;
  flaggor: Flagga[];
  motor: "anthropic" | "fallback";
  motorDetalj: string;
  id?: string;
  agentRuntime?: string;
  mall?: { id: string; version: string };
  systemPrompt?: string;
}): Proposal {
  const utanHash: Omit<Proposal, "hash"> = {
    contract_version: CONTRACT_VERSION,
    id: input.id ?? randomUUID(),
    tenant_id: input.tenantId,
    module: "bokforing",
    kind: "advisory_answer",
    ...(input.mall ? { mall_id: input.mall.id, mall_version: input.mall.version } : {}),
    affarshandelsedatum: input.extraktion.datum,
    motpart: input.extraktion.motpart,
    summary: `ESKALERING (ingen kontering): ${input.skal}`.slice(0, 300),
    lines: [],
    legal: [],
    // Eskaleringar är per definition lågkonfidenta beslut ÅT konsulten —
    // aldrig i närheten av någon auto-tröskel.
    confidence: 0.2,
    provenance: {
      ...(input.agentRuntime ? { agent_runtime: input.agentRuntime } : {}),
      model: input.motor === "anthropic" ? input.motorDetalj : "fallback:deterministisk",
      prompt_hash: sha256Hex(
        `grundbok-bokforing@${BOKFORING_MODULE_VERSION}|eskalering` +
          (input.systemPrompt ? `|prompt:${sha256Hex(input.systemPrompt)}` : ""),
      ),
      module_version: BOKFORING_MODULE_VERSION,
      input_refs: [`document:${input.documentId}`],
      injection_screened: true,
    },
  };
  return { ...utanHash, hash: hashProposal(utanHash) };
}
