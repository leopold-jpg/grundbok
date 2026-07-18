import type { PGlite } from "@electric-sql/pglite";
import type { ModuleId, ProposalKind } from "@/contracts";
import { hamtaMall, mallMajor, type MallId } from "@/mallar/registry";
import { skapaAgentNyckel, sattAgentStatus, listaAgentNycklar, type AgentRad } from "./agent-auth";
import { sparaPolicy } from "./decisions";
import type { Scope } from "./decisions";

// Provisionering (WP10, ADR-0003): "ny agent för en kund" är en
// databastransaktion. provisionAgent anropas av API-routen idag och av
// en Stripe-webhook imorgon — provisioned_by bär källan ('konsult:…'
// respektive 'stripe:<event_id>'), så self-service-köp är samma kodväg.
//
// WP12 (ADR-0004): en agent provisioneras helst ur en AGENTMALL — mallen
// bestämmer modul och förvald autonomipolicy, agentraden pekar på mallens
// major-version. module direkt är kvar för mall-lösa modulagenter.

export type ProvisioneringsInput = {
  tenantId: string;
  /** Krävs om mall saknas; ignoreras när mall anger modulen. */
  module?: ModuleId;
  /** Agentmall ur mallregistret (WP11) — sätter modul, mallpekare och
   *  förvald policy i samma svep. */
  mall?: MallId;
  displayName: string;
  scopes?: Scope[];
  /** Valfri autonomipolicy som sätts/uppdateras för tenant+modul i samma
   *  svep — vinner över mallens förval. */
  policy?: {
    max_belopp_ore: number;
    min_confidence: number;
    kanda_motparter_endast: boolean;
    tillatna_kinds: ProposalKind[];
  };
};

export type ProvisioneradAgent = {
  agent_id: string;
  /** Klartextnyckeln — returneras EN gång, visas aldrig igen. */
  nyckel: string;
};

export async function provisionAgent(
  db: PGlite,
  input: ProvisioneringsInput,
  provisionedBy: string,
): Promise<ProvisioneradAgent> {
  const mall = input.mall ? hamtaMall(input.mall) : null;
  if (input.mall && !mall) throw new Error(`agentmallen ${input.mall} finns inte i registret`);
  const module = mall?.module ?? input.module;
  if (!module) throw new Error("module eller mall krävs");

  // Explicit policy vinner; annars kopieras mallens förval till tenantens
  // policyrad (samma princip som operatörens policy_mallar: mallen är
  // startvärdet, kärnans rad är enda sanningen).
  const policy = input.policy ?? mall?.defaultPolicy;
  if (policy) {
    await sparaPolicy(db, {
      tenant_id: input.tenantId,
      module,
      ...policy,
    });
  }
  // Länka agenten till modulens policyrad (finns via seed eller ovan).
  const p = await db.query<{ id: string }>(
    `SELECT id FROM autonomy_policies WHERE tenant_id = $1 AND module = $2`,
    [input.tenantId, module],
  );
  const policyId = p.rows[0]?.id ?? null;

  const { id, nyckel } = await skapaAgentNyckel(db, {
    tenantId: input.tenantId,
    module,
    scopes: input.scopes ?? ["proposals:write"],
    namn: input.displayName,
    provisionedBy,
    policyId,
    template: mall ? { id: mall.id, major: mallMajor(mall.version) } : undefined,
  });

  return { agent_id: id, nyckel };
}

/** Avslut = statusändring, aldrig hård delete — beslutshistoriken
 *  refererar agenten (provenance + decided_by). */
export async function avslutaAgent(db: PGlite, tenantId: string, agentId: string): Promise<void> {
  await sattAgentStatus(db, tenantId, agentId, "canceled");
}

export async function pausaAgent(db: PGlite, tenantId: string, agentId: string): Promise<void> {
  await sattAgentStatus(db, tenantId, agentId, "paused");
}

export async function ateruppta(db: PGlite, tenantId: string, agentId: string): Promise<void> {
  await sattAgentStatus(db, tenantId, agentId, "active");
}

/** Tenant-scopad lista — innehåller aldrig nyckel eller hash. */
export async function listaAgenter(db: PGlite, tenantId: string): Promise<AgentRad[]> {
  return listaAgentNycklar(db, tenantId);
}
