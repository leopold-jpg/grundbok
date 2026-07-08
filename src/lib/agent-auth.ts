import { randomBytes } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { sha256Hex, type ModuleId } from "@/contracts";
import { withTenant } from "./db/tenant";
import { auditera } from "./ledger";
import type { Principal, Scope } from "./decisions";

// Scopade agentnycklar (WP4, ADR-0002). En OpenClaw-agent hos kund kör
// stateless: ingen DB-åtkomst, ingen hemlighet utöver sin nyckel — och
// nyckeln kan bara skapa förslag för sin tenant/modul, aldrig bokföra.

const NYCKELPREFIX = "gk_";

export type NyAgentNyckel = {
  id: string;
  /** Klartextnyckeln — visas EN gång; endast sha256-hashen lagras. */
  nyckel: string;
};

export async function skapaAgentNyckel(
  db: PGlite,
  input: {
    tenantId: string;
    module: ModuleId;
    scopes: Scope[];
    namn: string;
  },
): Promise<NyAgentNyckel> {
  const nyckel = NYCKELPREFIX + randomBytes(24).toString("base64url");
  const keyHash = sha256Hex(nyckel);

  const id = await withTenant(db, input.tenantId, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO agent_keys (tenant_id, module, namn, scopes, key_hash)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.tenantId, input.module, input.namn, JSON.stringify(input.scopes), keyHash],
    );
    await auditera(tx, input.tenantId, "agentnyckel_skapad", {
      keyId: r.rows[0].id,
      module: input.module,
      scopes: input.scopes,
      namn: input.namn,
    });
    return r.rows[0].id;
  });

  return { id, nyckel };
}

/**
 * Bearer-autentisering för POST /api/proposals. Uppslaget sker FÖRE
 * tenant-kontexten finns (det är nyckeln som ger oss tenanten) och körs
 * därför utanför withTenant — auth-lagret är kärnkod; RLS skyddar all
 * dataåtkomst som följer efter att principalen etablerats.
 */
export async function verifieraAgentNyckel(
  db: PGlite,
  authorizationHeader: string | null,
): Promise<Principal | null> {
  const bearer = authorizationHeader?.match(/^Bearer\s+(\S+)$/)?.[1];
  if (!bearer || !bearer.startsWith(NYCKELPREFIX)) return null;

  const r = await db.query<{
    tenant_id: string;
    module: ModuleId;
    scopes: Scope[];
    namn: string;
  }>(
    `SELECT tenant_id, module, scopes, namn
     FROM agent_keys WHERE key_hash = $1 AND active = true`,
    [sha256Hex(bearer)],
  );
  const rad = r.rows[0];
  if (!rad) return null;

  return {
    typ: "agent_nyckel",
    tenant_id: rad.tenant_id,
    module: rad.module,
    scopes: rad.scopes,
    namn: `nyckel:${rad.namn}`,
  };
}

/** Revoke = raden inaktiveras (aldrig radering — historiken består). */
export async function revokeraAgentNyckel(
  db: PGlite,
  tenantId: string,
  keyId: string,
): Promise<void> {
  await withTenant(db, tenantId, async (tx) => {
    await tx.query(
      `UPDATE agent_keys SET active = false, revoked_at = now() WHERE id = $1`,
      [keyId],
    );
    await auditera(tx, tenantId, "agentnyckel_revokerad", { keyId });
  });
}

export async function listaAgentNycklar(
  db: PGlite,
  tenantId: string,
): Promise<
  { id: string; module: string; namn: string; scopes: Scope[]; active: boolean; created_at: string }[]
> {
  return withTenant(db, tenantId, async (tx) => {
    const r = await tx.query<{
      id: string;
      module: string;
      namn: string;
      scopes: Scope[];
      active: boolean;
      created_at: string;
    }>(
      `SELECT id, module, namn, scopes, active, created_at
       FROM agent_keys ORDER BY created_at DESC`,
    );
    return r.rows.map((rad) => ({ ...rad, created_at: String(rad.created_at) }));
  });
}
