import { randomUUID } from "node:crypto";
import { hashProposal, sha256Hex, type Proposal } from "../src/contracts";

/** Giltigt journal_entry-förslag (kaffefakturans facit) med valfria overrides.
 *  Hash räknas om efter overrides — skicka egen `hash` för att testa manipulation. */
export function exempelProposal(overrides: Partial<Proposal> = {}): Proposal {
  const bas: Omit<Proposal, "hash"> = {
    contract_version: "0.2.0",
    id: randomUUID(),
    tenant_id: "kund_a",
    module: "bokforing",
    kind: "journal_entry",
    affarshandelsedatum: "2026-07-08",
    motpart: "Kafferosteriet Exempel AB",
    summary: "Kaffebönor, mörkrost 20 kg (livsmedel)",
    lines: [
      { konto: "4010", benamning: "Inköp material och varor", debet_ore: 100_000, kredit_ore: 0 },
      { konto: "2641", benamning: "Debiterad ingående moms", debet_ore: 6_000, kredit_ore: 0 },
      { konto: "2440", benamning: "Leverantörsskulder", debet_ore: 0, kredit_ore: 106_000 },
    ],
    legal: [{ lagrum: "Tillfällig sänkning, prop. 2025/26:55", ruleset: "se/moms@1.0.0" }],
    confidence: 0.9,
    provenance: {
      model: "claude-opus-4-8",
      prompt_hash: sha256Hex("systemprompt+se/moms@1.0.0"),
      module_version: "0.2.0",
      input_refs: ["document:00000000-0000-4000-8000-000000000001"],
      injection_screened: true,
    },
  };
  const sammanslagen = { ...bas, ...overrides };
  const { hash: _bort, ...utanHash } = sammanslagen as Proposal;
  return { ...utanHash, hash: overrides.hash ?? hashProposal(utanHash) } as Proposal;
}
