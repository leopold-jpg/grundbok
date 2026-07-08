import { z } from "zod";
import { CONTRACT_VERSION } from "./proposal-contract";

// Runtime-validering av kontraktet (zod-speglingar av typerna i
// proposal-contract.ts). Kärnan litar aldrig på att en agent skickar
// välformad data — allt valideras här innan beslutsmotorn rör det.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export const MODULE_IDS = [
  "bokforing",
  "loner",
  "skatt-juridik",
  "bokslut",
  "radgivning",
] as const;

export const PROPOSAL_KINDS = [
  "journal_entry",
  "correction",
  "adjustment",
  "payroll_run",
  "advisory_answer",
] as const;

export const SCOPES = ["proposals:write", "ledger:read", "documents:read"] as const;

export const ProposalLineSchema = z.object({
  konto: z.string().regex(/^[1-8]\d{3}$/, "BAS-konto: fyra siffror, klass 1–8"),
  benamning: z.string().min(1),
  debet_ore: z.number().int().nonnegative(),
  kredit_ore: z.number().int().nonnegative(),
});

export const LegalReferenceSchema = z.object({
  lagrum: z.string().min(1),
  ruleset: z.string().min(1),
  note: z.string().optional(),
});

export const ProvenanceSchema = z.object({
  model: z.string().min(1),
  prompt_hash: z.string().regex(SHA256),
  module_version: z.string().min(1),
  agent_runtime: z.string().optional(),
  input_refs: z.array(z.string()),
  injection_screened: z.boolean(),
});

export const ProposalSchema = z
  .object({
    contract_version: z.literal(CONTRACT_VERSION),
    id: z.string().regex(UUID),
    tenant_id: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
    module: z.enum(MODULE_IDS),
    kind: z.enum(PROPOSAL_KINDS),
    batch_id: z.string().optional(),
    affarshandelsedatum: z.string().regex(ISO_DATUM),
    motpart: z.string().optional(),
    summary: z.string().min(1).max(300),
    lines: z.array(ProposalLineSchema),
    legal: z.array(LegalReferenceSchema),
    confidence: z.number().min(0).max(1),
    provenance: ProvenanceSchema,
    hash: z.string().regex(SHA256),
  })
  .superRefine((p, ctx) => {
    if (p.kind === "advisory_answer") {
      if (p.lines.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["lines"],
          message: "advisory_answer får inte ha konteringsrader",
        });
      }
      return;
    }
    // Alla ledger-verkande kinds: minst två rader och debet = kredit.
    if (p.lines.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["lines"],
        message: `${p.kind} kräver minst två konteringsrader`,
      });
      return;
    }
    const debet = p.lines.reduce((s, r) => s + r.debet_ore, 0);
    const kredit = p.lines.reduce((s, r) => s + r.kredit_ore, 0);
    if (debet !== kredit) {
      ctx.addIssue({
        code: "custom",
        path: ["lines"],
        message: `debet (${debet}) ≠ kredit (${kredit}) — obalanserat förslag avvisas`,
      });
    }
    if (p.kind === "correction") {
      const harRef = p.provenance.input_refs.some((r) => r.startsWith("verification:"));
      if (!harRef) {
        ctx.addIssue({
          code: "custom",
          path: ["provenance", "input_refs"],
          message:
            'correction kräver referens till den rättade verifikationen: "verification:<uuid>" i input_refs',
        });
      }
    }
  });

export const DecisionInputSchema = z.object({
  proposal_id: z.string().regex(UUID),
  outcome: z.enum(["approved", "rejected"]),
  decided_by: z.string().min(1),
  reason: z.string().optional(),
});

export const AutonomyPolicySchema = z.object({
  tenant_id: z.string(),
  module: z.enum(MODULE_IDS),
  auto_approve: z.object({
    max_belopp_ore: z.number().int().nonnegative(),
    min_confidence: z.number().min(0).max(1),
    kanda_motparter_endast: z.boolean(),
    tillatna_kinds: z.array(z.enum(PROPOSAL_KINDS)),
  }),
});

export type ProposalInput = z.infer<typeof ProposalSchema>;
export type DecisionInput = z.infer<typeof DecisionInputSchema>;
export type AutonomyPolicyInput = z.infer<typeof AutonomyPolicySchema>;
