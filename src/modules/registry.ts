import type { PGlite } from "@electric-sql/pglite";
import type { ModuleId, Proposal } from "@/contracts";
import { tolka } from "@/lib/extract";
import { kontera, type Flagga } from "@/lib/kontering";
import { granskaUnderlag } from "@/lib/granskning";
import { byggBokforingsProposal, byggEskaleringsProposal } from "@/lib/bokforing-modul";

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
  /** Mallstämpeln (WP11, ADR-0004): läses ur agentraden av runtime-lagret
   *  och stämplas på förslaget. Utelämnad för mall-lösa agenter. */
  mall?: { id: string; version: string };
  /** Den kompletta systemprompten (WP31): rollprompt + tenantens aktiva
   *  branschpakets regler (byggSystemPrompt). Går till LLM-vägen och in i
   *  provenance.prompt_hash. Utelämnad för mall-lösa agenter. */
  systemPrompt?: string;
};

/** Modulens utfall (WP32): förslaget + modulens granskningsflaggor.
 *  Flaggorna är runtime-lagrets kunskap och följer med till porten som
 *  betrodd metadata — de ingår aldrig i den hashade payloaden. */
export type ModulUtfall = { proposal: Proposal; flaggor: Flagga[] };

export interface ModulRuntime {
  id: ModuleId;
  buildProposal(input: ModulInput): Promise<ModulUtfall>;
}

const bokforing: ModulRuntime = {
  id: "bokforing",
  async buildProposal(input) {
    const tolkning = await tolka(input.underlag, input.systemPrompt);

    // Granskningsordningen (WP30/WP32) körs deterministiskt före
    // konteringen: mottagarkontroll först, sedan privat, förskott,
    // delmatchning, ÄTA, dubblett och anomali.
    const granskning = await granskaUnderlag(input.db, input.tenantId, tolkning.extraktion);

    if (granskning.eskalera) {
      const proposal = byggEskaleringsProposal({
        tenantId: input.tenantId,
        documentId: input.underlagRef,
        extraktion: tolkning.extraktion,
        skal: granskning.eskaleringsSkal ?? "granskningen eskalerade underlaget",
        flaggor: granskning.flaggor,
        motor: tolkning.motor,
        motorDetalj: tolkning.motor_detalj,
        id: input.proposalId,
        agentRuntime: input.agentRuntime,
        mall: input.mall,
        systemPrompt: input.systemPrompt,
      });
      return { proposal, flaggor: granskning.flaggor };
    }

    const forslag = kontera(
      tolkning.extraktion,
      input.tenantId,
      undefined,
      granskning.kostnadskontoOverride,
    );
    // Granskningens flaggor in i förslaget INNAN konfidensen räknas —
    // varningsflaggor (dubblett, delmatchning, ÄTA) sänker konfidensen
    // och trycker förslaget till granskningskön (bokforingsKonfidens).
    forslag.flaggor.push(...granskning.flaggor);
    const proposal = byggBokforingsProposal({
      systemPrompt: input.systemPrompt,
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
      mall: input.mall,
    });
    return { proposal, flaggor: forslag.flaggor };
  },
};

// radgivning körs inte via jobb-kön i v0: dess flöde är fråga→svar i
// requesttid (svaraPaFraga bygger och POST:ar i ett steg). Bryts ut till
// buildProposal-formen när kö-triggade rådgivningsjobb finns på riktigt.
export const MODUL_REGISTRY: Partial<Record<ModuleId, ModulRuntime>> = {
  bokforing,
};
