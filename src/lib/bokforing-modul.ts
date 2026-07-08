import { randomUUID } from "node:crypto";
import { hashProposal, sha256Hex, type Proposal, type LegalReference } from "@/contracts";
import type { Forslag } from "./kontering";
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
    contract_version: "0.2.0",
    id: randomUUID(),
    tenant_id: input.tenantId,
    module: "bokforing",
    kind: "journal_entry",
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
      model: input.motor === "anthropic" ? input.motorDetalj : "fallback:deterministisk",
      prompt_hash: sha256Hex(
        `grundbok-bokforing@${BOKFORING_MODULE_VERSION}|` +
          JSON.stringify(forslag.skill_versions),
      ),
      module_version: BOKFORING_MODULE_VERSION,
      input_refs: [`document:${input.documentId}`],
      injection_screened: true, // tolka-routen screenar dokumentet före LLM
    },
  };

  return { ...utanHash, hash: hashProposal(utanHash) };
}
