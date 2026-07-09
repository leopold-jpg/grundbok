import { randomBytes } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { sha256Hex, type ModuleId } from "@/contracts";
import { withTenant } from "./db/tenant";
import { auditera } from "./ledger";
import type { Principal, Scope } from "./decisions";

// Auth mot control plane-tabellen agents (WP8, ADR-0003): en agent är en
// rad — nyckeln är radens legitimation. Skrivningar (skapa/pausa/avsluta)
// går via kärnans service-väg (superuser-anslutningen), aldrig app-rollen;
// appen har enbart tenant-scopad läsning via RLS.

const NYCKELPREFIX = "gk_";

export type NyAgentNyckel = {
  id: string;
  /** Klartextnyckeln — visas EN gång; endast sha256-hashen lagras. */
  nyckel: string;
};

export type AgentStatus = "active" | "paused" | "canceled";

/**
 * Verifieringsutfall — porten skiljer på okänd nyckel (401) och en känd
 * agent som är pausad/avslutad (403): kunden ska se skillnad på "fel
 * nyckel" och "din agent är avstängd".
 */
export type NyckelUtfall =
  | { typ: "ok"; principal: Principal; agentId: string }
  | { typ: "inaktiv"; status: AgentStatus; agentId: string }
  | { typ: "okand" };

export async function skapaAgentNyckel(
  db: PGlite,
  input: {
    tenantId: string;
    module: ModuleId;
    scopes: Scope[];
    namn: string;
    provisionedBy?: string;
    policyId?: string | null;
  },
): Promise<NyAgentNyckel> {
  const nyckel = NYCKELPREFIX + randomBytes(24).toString("base64url");
  const keyHash = sha256Hex(nyckel);

  // Service-vägen: skrivning till agents sker aldrig via app-rollen.
  const r = await db.query<{ id: string }>(
    `INSERT INTO agents (tenant_id, module, display_name, key_hash, scopes, policy_id, provisioned_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      input.tenantId,
      input.module,
      input.namn,
      keyHash,
      input.scopes,
      input.policyId ?? null,
      input.provisionedBy ?? "admin-ui",
    ],
  );
  const id = r.rows[0].id;

  await withTenant(db, input.tenantId, (tx) =>
    auditera(tx, input.tenantId, "agent_provisionerad", {
      agentId: id,
      module: input.module,
      scopes: input.scopes,
      displayName: input.namn,
      provisionedBy: input.provisionedBy ?? "admin-ui",
    }),
  );

  return { id, nyckel };
}

/**
 * Bearer-autentisering för POST /api/proposals. Uppslaget sker FÖRE
 * tenant-kontexten finns (det är nyckeln som ger oss tenanten) och körs
 * därför på service-vägen — RLS skyddar all dataåtkomst som följer efter
 * att principalen etablerats.
 */
export async function verifieraAgentNyckel(
  db: PGlite,
  authorizationHeader: string | null,
): Promise<NyckelUtfall> {
  const bearer = authorizationHeader?.match(/^Bearer\s+(\S+)$/)?.[1];
  if (!bearer || !bearer.startsWith(NYCKELPREFIX)) return { typ: "okand" };

  const r = await db.query<{
    id: string;
    tenant_id: string;
    module: ModuleId;
    scopes: Scope[];
    display_name: string;
    status: AgentStatus;
  }>(
    `SELECT id, tenant_id, module, scopes, display_name, status
     FROM agents WHERE key_hash = $1`,
    [sha256Hex(bearer)],
  );
  const rad = r.rows[0];
  if (!rad) return { typ: "okand" };
  if (rad.status !== "active") {
    return { typ: "inaktiv", status: rad.status, agentId: rad.id };
  }

  return {
    typ: "ok",
    agentId: rad.id,
    principal: {
      typ: "agent_nyckel",
      tenant_id: rad.tenant_id,
      module: rad.module,
      scopes: rad.scopes,
      namn: `agent:${rad.display_name}`,
    },
  };
}

/** Statusändring — aldrig hård delete: beslutshistoriken refererar agenten. */
export async function sattAgentStatus(
  db: PGlite,
  tenantId: string,
  agentId: string,
  status: AgentStatus,
): Promise<void> {
  await db.query(
    `UPDATE agents SET status = $1, revoked_at = CASE WHEN $1 = 'canceled' THEN now() ELSE revoked_at END
     WHERE id = $2 AND tenant_id = $3`,
    [status, agentId, tenantId],
  );
  await withTenant(db, tenantId, (tx) =>
    auditera(tx, tenantId, "agent_statusandrad", { agentId, status }),
  );
}

/** Bakåtkompatibelt namn: revoke = canceled (raden inaktiveras, består). */
export async function revokeraAgentNyckel(
  db: PGlite,
  tenantId: string,
  agentId: string,
): Promise<void> {
  await sattAgentStatus(db, tenantId, agentId, "canceled");
}

export type AgentRad = {
  id: string;
  module: string;
  namn: string;
  scopes: Scope[];
  status: AgentStatus;
  active: boolean;
  max_concurrency: number;
  provisioned_by: string;
  created_at: string;
};

/** Tenant-scopad läsning via RLS — innehåller ALDRIG nyckel eller hash. */
export async function listaAgentNycklar(
  db: PGlite,
  tenantId: string,
): Promise<AgentRad[]> {
  return withTenant(db, tenantId, async (tx) => {
    const r = await tx.query<{
      id: string;
      module: string;
      display_name: string;
      scopes: Scope[];
      status: AgentStatus;
      max_concurrency: number;
      provisioned_by: string;
      created_at: string;
    }>(
      `SELECT id, module, display_name, scopes, status, max_concurrency, provisioned_by, created_at
       FROM agents ORDER BY created_at DESC`,
    );
    return r.rows.map((rad) => ({
      id: rad.id,
      module: rad.module,
      namn: rad.display_name,
      scopes: rad.scopes,
      status: rad.status,
      active: rad.status === "active",
      max_concurrency: Number(rad.max_concurrency),
      provisioned_by: rad.provisioned_by,
      created_at: String(rad.created_at),
    }));
  });
}
