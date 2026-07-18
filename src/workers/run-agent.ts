import type { PGlite } from "@electric-sql/pglite";
import type { ModuleId } from "@/contracts";
import { withTenant } from "@/lib/db/tenant";
import { handleProposal, type Principal, type Scope } from "@/lib/decisions";
import { MODUL_REGISTRY } from "@/modules/registry";
import { hamtaMallForMajor, byggSystemPrompt } from "@/mallar/registry";
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

  // Branschpaketen in i LLM-vägen (WP31): tenantens branschmall
  // (tenants.mall) aktiverar paketen, och den kompletta systemprompten
  // vävs ihop här — per jobb, aldrig lagrad på agentraden (en bransch-
  // ändring hos tenanten slår igenom utan agentmigration, ADR-0005).
  let systemPrompt: string | undefined;
  if (mall) {
    const t = await db.query<{ mall: string }>(`SELECT mall FROM tenants WHERE id = $1`, [
      jobb.tenant_id,
    ]);
    systemPrompt = byggSystemPrompt(mall, t.rows[0]?.mall ?? "");
  }

  const proposal = await runtime.buildProposal({
    db,
    tenantId: jobb.tenant_id,
    underlag: underlag.raw,
    underlagRef: underlag.id,
    proposalId,
    agentRuntime: WORKER_RUNTIME,
    mall: mall ? { id: mall.id, version: mall.version } : undefined,
    systemPrompt,
  });

  const principal: Principal = {
    typ: "agent_nyckel",
    tenant_id: agent.tenant_id,
    module: agent.module,
    scopes: agent.scopes,
    namn: `agent:${agent.display_name}`,
    agent_id: agent.id,
  };

  const resultat = await handleProposal(db, principal, proposal);
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
