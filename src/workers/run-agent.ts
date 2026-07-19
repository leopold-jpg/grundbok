import type { PGlite } from "@electric-sql/pglite";
import {
  propagateAttributes,
  startActiveObservation,
  updateActiveObservation,
} from "@langfuse/tracing";
import type { ModuleId } from "@/contracts";
import { withTenant } from "@/lib/db/tenant";
import { handleProposal, type Principal, type Scope } from "@/lib/decisions";
import { MODUL_REGISTRY } from "@/modules/registry";
import { hamtaMallForMajor, byggSystemPrompt, aktivaBranschpaket } from "@/mallar/registry";
import type { GranskningsKontext } from "@/lib/granskning";
import { uuidv5 } from "@/lib/uuid5";
import type { AgentJobb } from "@/lib/queue";

// EN generisk worker (WP9, ADR-0003): agentkoden deployas en gång och
// servar alla tenants. körJobb är ren i förhållande till kön — läsning,
// ack och retry ägs av cron-lagret.
//
// Identitet: en EXTERN agent (OpenClaw hos kund) håller sin klartextnyckel
// och POST:ar mot /api/proposals. Molnworkern ÄR agentens runtime och
// agerar med agent-radens identitet — samma principal-form, samma port
// (handleProposal), samma tenant-/modul-/scope-kontroller. Klartextnyckeln
// finns aldrig i kärnan (endast hash), så workern kan inte "låna" den.

export const WORKER_RUNTIME = "worker-lokal@0.2";

export type JobbUtfall =
  | { utfall: "klar"; proposal_id: string; status: "pending" | "auto_approved" }
  | { utfall: "duplicate"; proposal_id: string }
  | { utfall: "skip"; detalj: string }
  | { utfall: "fel"; detalj: string };

type AgentRad = {
  id: string;
  tenant_id: string;
  module: ModuleId;
  display_name: string;
  scopes: Scope[];
  status: "active" | "paused" | "canceled";
  max_concurrency: number;
  template_id: string | null;
  template_version: string;
};

export async function körJobb(db: PGlite, jobb: AgentJobb): Promise<JobbUtfall> {
  // Langfuse-trace per jobb, typad "agent" — workern ÄR agentens runtime,
  // så jobbet blir en agentnod i Langfuses Agent Graph. tenant_id och
  // agent_id på varje trace (kravet); mall-stämpeln kompletteras inne i
  // körJobbInner när majorn är löst. No-op utan LANGFUSE-nycklar.
  return propagateAttributes(
    {
      traceName: `agent-jobb:${jobb.module}`,
      userId: jobb.tenant_id,
      metadata: { tenant_id: jobb.tenant_id, agent_id: jobb.agent_id },
      tags: ["worker", jobb.module],
    },
    () =>
      startActiveObservation(
        "agent-jobb",
        async (span) => {
          const utfall = await körJobbInner(db, jobb);
          span.update({
            input: { payload_ref: jobb.payload_ref, job_id: jobb.job_id },
            // utfall.detalj kan citera portens felsträngar — maskeras av
            // processorn ("detalj" står inte i allowlisten).
            output: utfall,
            ...(utfall.utfall === "fel"
              ? { level: "ERROR" as const, statusMessage: "jobbet föll" }
              : {}),
          });
          return utfall;
        },
        { asType: "agent" },
      ),
  );
}

async function körJobbInner(db: PGlite, jobb: AgentJobb): Promise<JobbUtfall> {
  // Agent-raden läses på service-vägen (workern är data plane).
  const r = await db.query<AgentRad>(`SELECT * FROM agents WHERE id = $1`, [jobb.agent_id]);
  const agent = r.rows[0];
  if (!agent) return { utfall: "fel", detalj: `agent ${jobb.agent_id} finns inte` };

  // Jobbets tenant måste vara agentens tenant — ett jobb kan aldrig
  // låna en annan tenants agent (smoke-test 3 i kickoff-tillägget).
  if (agent.tenant_id !== jobb.tenant_id) {
    return {
      utfall: "fel",
      detalj: `tenant-mismatch: jobbet avser ${jobb.tenant_id}, agenten tillhör ${agent.tenant_id}`,
    };
  }
  if (agent.module !== jobb.module) {
    return { utfall: "fel", detalj: `modul-mismatch: jobb ${jobb.module}, agent ${agent.module}` };
  }
  // Pausad/avslutad agent: jobbet ack:as och hoppas över (kickoff WP9).
  if (agent.status !== "active") {
    return { utfall: "skip", detalj: `agenten är ${agent.status}` };
  }

  const runtime = MODUL_REGISTRY[jobb.module as ModuleId];
  if (!runtime) {
    return { utfall: "fel", detalj: `ingen worker-runtime för modulen ${jobb.module}` };
  }

  // Underlag från storage-referensen — kön bär aldrig rå data.
  // Lokalt: "document:<uuid>" i kärnan; i produktion en Supabase
  // Storage-URI bakom samma funktion.
  const underlag = await hamtaUnderlag(db, jobb.tenant_id, jobb.payload_ref);
  if (underlag === null) {
    return { utfall: "fel", detalj: `underlaget ${jobb.payload_ref} finns inte för tenanten` };
  }

  // Idempotens: proposal-id deriveras deterministiskt ur job_id (uuid v5)
  // — omkörning ger duplicate i porten, aldrig dubbelbokföring.
  const proposalId = uuidv5(jobb.job_id);

  // Mallstämpeln (WP12, ADR-0004): agentens major-pekare löses mot
  // registrets aktuella version — den EXAKTA versionen stämplas på
  // förslaget. null = mall-lös agent eller versionsdrift (borttagen
  // major); förslaget byggs då ostämplat och driften syns i flottvyn.
  const mall = agent.template_id
    ? hamtaMallForMajor(agent.template_id, agent.template_version)
    : null;

  // Promptversionen på jobbets agentnod (kravet: mall_id + mall_version):
  // "saknas" för mall-lös agent/versionsdrift — samma semantik som den
  // ostämplade proposalen. prompt_hash stämplas på generationen
  // (extract/anthropic.ts).
  updateActiveObservation(
    {
      metadata: {
        mall_id: mall?.id ?? "saknas",
        mall_version: mall?.version ?? "saknas",
      },
    },
    { asType: "agent" },
  );

  // Branschpaketen in i LLM-vägen (WP31): tenantens branschmall
  // (tenants.mall) aktiverar paketen, och den kompletta systemprompten
  // vävs ihop här — per jobb, aldrig lagrad på agentraden (en bransch-
  // ändring hos tenanten slår igenom utan agentmigration, ADR-0005).
  // Tenant-raden slås upp EN gång och följer med som granskningskontext;
  // paketaktiveringen är mall∩tenant-snittet — en mall-lös agent kör
  // inga paketregler, varken i prompten eller i granskningsmotorn.
  const t = await db.query<{ namn: string; mall: string }>(
    `SELECT namn, mall FROM tenants WHERE id = $1`,
    [jobb.tenant_id],
  );
  const tenantNamn = t.rows[0]?.namn ?? "";
  const tenantMall = t.rows[0]?.mall ?? "";
  const systemPrompt = mall ? byggSystemPrompt(mall, tenantMall) : undefined;
  const granskningsKontext: GranskningsKontext = {
    tenantNamn,
    tenantMall,
    aktivaPaket: mall ? aktivaBranschpaket(mall, tenantMall).map((p) => p.id) : [],
  };

  const { proposal, flaggor } = await runtime.buildProposal({
    db,
    tenantId: jobb.tenant_id,
    underlag: underlag.raw,
    underlagRef: underlag.id,
    proposalId,
    agentRuntime: WORKER_RUNTIME,
    mall: mall ? { id: mall.id, version: mall.version } : undefined,
    systemPrompt,
    granskningsKontext,
  });

  const principal: Principal = {
    typ: "agent_nyckel",
    tenant_id: agent.tenant_id,
    module: agent.module,
    scopes: agent.scopes,
    namn: `agent:${agent.display_name}`,
    agent_id: agent.id,
  };

  // Modulens granskningsflaggor (WP32) följer med som betrodd runtime-
  // metadata — porten persisterar dem i proposals.flaggor tillsammans
  // med sina egna (injection-screening).
  const resultat = await handleProposal(db, principal, proposal, flaggor);
  switch (resultat.status) {
    case "duplicate":
      return { utfall: "duplicate", proposal_id: resultat.proposal_id };
    case "pending":
      return { utfall: "klar", proposal_id: resultat.proposal_id, status: "pending" };
    case "auto_approved":
      return { utfall: "klar", proposal_id: resultat.proposal_id, status: "auto_approved" };
    case "avvisad_vid_porten":
      return { utfall: "fel", detalj: resultat.fel.join("; ") };
  }
}

async function hamtaUnderlag(
  db: PGlite,
  tenantId: string,
  payloadRef: string,
): Promise<{ id: string; raw: string } | null> {
  const dokumentId = payloadRef.startsWith("document:")
    ? payloadRef.slice("document:".length)
    : null;
  if (!dokumentId) return null;
  return withTenant(db, tenantId, async (tx) => {
    const r = await tx.query<{ id: string; raw: string }>(
      `SELECT id, raw FROM documents WHERE id = $1`,
      [dokumentId],
    );
    return r.rows[0] ?? null;
  });
}
