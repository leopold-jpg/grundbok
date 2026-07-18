import type { PGlite } from "@electric-sql/pglite";
import type { ModuleId, ProposalKind } from "@/contracts";
import { withTenant } from "./db/tenant";
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

  // Explicit policy vinner (upsert — anroparen har uttryckligen valt en
  // autonominivå). Mallens förval är däremot ett STARTVÄRDE (ADR-0004:
  // kundunikhet bor i autonomipolicyn): det seedar en SAKNAD policyrad
  // men skriver aldrig över en befintlig — en byrå-tunad policy får inte
  // tyst ersättas av att operatören provisionerar ytterligare en agent.
  if (input.policy) {
    await sparaPolicy(db, {
      tenant_id: input.tenantId,
      module,
      ...input.policy,
    });
  } else if (mall) {
    // Atomär seedning (granskningsfynd, ADR-0005-passet): SELECT-före-
    // insert kunde racea mot en samtidig provisionering (t.ex. framtida
    // Stripe-webhook) — ON CONFLICT DO NOTHING låter databasen avgöra,
    // och en befintlig rad rörs aldrig.
    await withTenant(db, input.tenantId, (tx) =>
      tx.query(
        `INSERT INTO autonomy_policies
           (tenant_id, module, max_belopp_ore, min_confidence, kanda_motparter_endast, tillatna_kinds, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (tenant_id, module) DO NOTHING`,
        [
          input.tenantId,
          module,
          mall.defaultPolicy.max_belopp_ore,
          mall.defaultPolicy.min_confidence,
          mall.defaultPolicy.kanda_motparter_endast,
          JSON.stringify(mall.defaultPolicy.tillatna_kinds),
        ],
      ),
    );
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
