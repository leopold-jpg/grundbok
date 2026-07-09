import type { PGlite } from "@electric-sql/pglite";
import type { ModuleId, Proposal } from "@/contracts";
import { tolka } from "@/lib/extract";
import { kontera } from "@/lib/kontering";
import { byggBokforingsProposal } from "@/lib/bokforing-modul";

// Modulregistret (WP9): det rena interfacet mellan runtime och modul.
// buildProposal är sidoeffektsfri mot kärnan — den bygger ett Proposal,
// den POST:ar aldrig själv. Samma funktion ska kunna köras av molnworkern
// och av OpenClaw lokalt i dev (ADR-0003: agentkod = rena funktioner).

export type ModulInput = {
  db: PGlite;
  tenantId: string;
  /** Underlaget, hämtat ur storage av runtime-lagret (aldrig ur kön). */
  underlag: string;
  /** Referensens id (lokalt: dokumentets uuid ur "document:<uuid>"). */
  underlagRef: string;
  /** Deterministiskt proposal-id (uuid v5 av job_id) — idempotensnyckeln. */
  proposalId: string;
  /** T.ex. "worker-lokal@0.2" eller "openclaw@x.y" — provenance.agent_runtime. */
  agentRuntime: string;
};

export interface ModulRuntime {
  id: ModuleId;
  buildProposal(input: ModulInput): Promise<Proposal>;
}

const bokforing: ModulRuntime = {
  id: "bokforing",
  async buildProposal(input) {
    const tolkning = await tolka(input.underlag);
    const forslag = kontera(tolkning.extraktion, input.tenantId);
    return byggBokforingsProposal({
      tenantId: input.tenantId,
      // payload_ref är ett dokument i kärnan lokalt — dess uuid blir
      // input_ref. Runtime-lagret har redan verifierat att det finns.
      documentId: input.underlagRef,
      extraktion: tolkning.extraktion,
      forslag,
      motor: tolkning.motor,
      motorDetalj: tolkning.motor_detalj,
      id: input.proposalId,
      agentRuntime: input.agentRuntime,
    });
  },
};

// radgivning körs inte via jobb-kön i v0: dess flöde är fråga→svar i
// requesttid (svaraPaFraga bygger och POST:ar i ett steg). Bryts ut till
// buildProposal-formen när kö-triggade rådgivningsjobb finns på riktigt.
export const MODUL_REGISTRY: Partial<Record<ModuleId, ModulRuntime>> = {
  bokforing,
};
