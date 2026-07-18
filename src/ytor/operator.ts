import { randomBytes } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { sha256Hex, type ModuleId, type ProposalKind } from "@/contracts";
import { provisionAgent, type ProvisioneradAgent } from "@/lib/provisioning";
import { auditera } from "@/lib/ledger";
import { PgliteKo } from "@/lib/queue";
import type { Scope } from "@/lib/decisions";

// Operatörskonsolen (WP14) — grundarens vy. Regeln som allt här lyder
// under: operatören ser AGGREGAT, aldrig innehåll. Antal förslag är drift;
// summary, belopp och motpart är byråns värld. Ingen fråga i den här
// filen läser proposals.payload eller verifikationer.

export type BolagsRad = {
  byra: string;
  tenant_id: string;
  tenant_namn: string;
  mall: string;
  agenter_aktiva: number;
  agenter_pausade: number;
  /** Aggregat — ett ANTAL förslag senaste 7 dygnen, aldrig innehåll. */
  forslag_7d: number;
  beslut_7d: number;
};

export async function bolagsoversikt(db: PGlite): Promise<BolagsRad[]> {
  const r = await db.query<{
    byra: string | null;
    tenant_id: string;
    tenant_namn: string;
    mall: string;
    agenter_aktiva: string;
    agenter_pausade: string;
    forslag_7d: string;
    beslut_7d: string;
  }>(
    `SELECT b.namn AS byra, t.id AS tenant_id, t.namn AS tenant_namn, t.mall,
            (SELECT count(*) FROM agents a
              WHERE a.tenant_id = t.id AND a.status = 'active')  AS agenter_aktiva,
            (SELECT count(*) FROM agents a
              WHERE a.tenant_id = t.id AND a.status = 'paused')  AS agenter_pausade,
            (SELECT count(*) FROM proposals p
              WHERE p.tenant_id = t.id
                AND p.created_at > now() - interval '7 days')    AS forslag_7d,
            (SELECT count(*) FROM decisions d
              WHERE d.tenant_id = t.id
                AND d.decided_at > now() - interval '7 days')    AS beslut_7d
     FROM tenants t LEFT JOIN byraer b ON b.id = t.byra_id
     ORDER BY b.namn NULLS LAST, t.namn`,
  );
  return r.rows.map((row) => ({
    byra: row.byra ?? "(utan byrå)",
    tenant_id: row.tenant_id,
    tenant_namn: row.tenant_namn,
    mall: row.mall,
    agenter_aktiva: Number(row.agenter_aktiva),
    agenter_pausade: Number(row.agenter_pausade),
    forslag_7d: Number(row.forslag_7d),
    beslut_7d: Number(row.beslut_7d),
  }));
}

// ------------------------------------------------------------- mallar

export type PolicyMall = {
  id: string;
  namn: string;
  module: ModuleId;
  max_belopp_ore: number;
  min_confidence: number;
  kanda_motparter_endast: boolean;
  tillatna_kinds: ProposalKind[];
};

export async function listaMallar(db: PGlite): Promise<PolicyMall[]> {
  const r = await db.query<{
    id: string;
    namn: string;
    module: ModuleId;
    max_belopp_ore: string;
    min_confidence: string;
    kanda_motparter_endast: boolean;
    tillatna_kinds: ProposalKind[];
  }>(`SELECT * FROM policy_mallar ORDER BY namn`);
  return r.rows.map((m) => ({
    ...m,
    max_belopp_ore: Number(m.max_belopp_ore),
    min_confidence: Number(m.min_confidence),
  }));
}

export async function sparaMall(
  db: PGlite,
  mall: Omit<PolicyMall, "id"> & { id?: string },
): Promise<{ id: string }> {
  if (mall.id) {
    const r = await db.query<{ id: string }>(
      `UPDATE policy_mallar
       SET namn = $2, module = $3, max_belopp_ore = $4, min_confidence = $5,
           kanda_motparter_endast = $6, tillatna_kinds = $7
       WHERE id = $1 RETURNING id`,
      [
        mall.id,
        mall.namn,
        mall.module,
        mall.max_belopp_ore,
        mall.min_confidence,
        mall.kanda_motparter_endast,
        JSON.stringify(mall.tillatna_kinds),
      ],
    );
    if (!r.rows[0]) throw new Error("mallen finns inte");
    return r.rows[0];
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO policy_mallar
       (namn, module, max_belopp_ore, min_confidence, kanda_motparter_endast, tillatna_kinds)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      mall.namn,
      mall.module,
      mall.max_belopp_ore,
      mall.min_confidence,
      mall.kanda_motparter_endast,
      JSON.stringify(mall.tillatna_kinds),
    ],
  );
  return r.rows[0];
}

// ------------------------------------------------------- provisionering

/** Provisionering med vald mall: mallens värden kopieras till tenantens
 *  policy i samma svep (provisionAgent gör upsert + länkar policy_id). */
export async function provisioneraMedMall(
  db: PGlite,
  input: {
    tenantId: string;
    displayName: string;
    mallId?: string;
    module?: ModuleId;
    scopes?: Scope[];
  },
  provisionedBy: string,
): Promise<ProvisioneradAgent & { module: ModuleId }> {
  let module = input.module;
  let policy: PolicyMall | undefined;

  if (input.mallId) {
    const mallar = await listaMallar(db);
    policy = mallar.find((m) => m.id === input.mallId);
    if (!policy) throw new Error("policymallen finns inte");
    module = policy.module;
  }
  if (!module) throw new Error("module eller mall_id krävs");

  const ny = await provisionAgent(
    db,
    {
      tenantId: input.tenantId,
      module,
      displayName: input.displayName,
      scopes: input.scopes,
      policy: policy
        ? {
            max_belopp_ore: policy.max_belopp_ore,
            min_confidence: policy.min_confidence,
            kanda_motparter_endast: policy.kanda_motparter_endast,
            tillatna_kinds: policy.tillatna_kinds,
          }
        : undefined,
    },
    provisionedBy,
  );
  return { ...ny, module };
}

/** Nyckelrotation som ETT flöde: ny agent med samma konfiguration skapas
 *  och den gamla avslutas i EN databastransaktion — misslyckas något
 *  rullas allt tillbaka och varken ny agent eller nyckel finns (Bugbot
 *  PR #2, hög). provisionAgent/avslutaAgent kan inte återanvändas här:
 *  de öppnar egna withTenant-transaktioner (nästlad transaktion), så
 *  stegen görs inline med samma SQL och audit-händelser som kärnans
 *  agent-auth.ts. Klartextnyckeln returneras EN gång. */
export async function roteraNyckel(
  db: PGlite,
  tenantId: string,
  agentId: string,
  provisionedBy: string,
): Promise<ProvisioneradAgent & { ersatte: string }> {
  // Samma prefix som agent-auth.ts (NYCKELPREFIX är modulprivat i kärnan).
  const nyckel = "gk_" + randomBytes(24).toString("base64url");

  const nyttId = await db.transaction(async (tx) => {
    const gammal = await tx.query<{
      module: ModuleId;
      display_name: string;
      scopes: Scope[];
      status: string;
      policy_id: string | null;
      max_concurrency: number;
      template_id: string | null;
      template_version: string;
    }>(
      `SELECT module, display_name, scopes, status, policy_id, max_concurrency,
              template_id, template_version
       FROM agents WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [agentId, tenantId],
    );
    const a = gammal.rows[0];
    if (!a) throw new Error("agenten finns inte");
    if (a.status === "canceled") throw new Error("agenten är redan avslutad");

    const ny = await tx.query<{ id: string }>(
      `INSERT INTO agents
         (tenant_id, module, display_name, key_hash, scopes, policy_id, max_concurrency,
          provisioned_by, template_id, template_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        tenantId,
        a.module,
        a.display_name,
        sha256Hex(nyckel),
        a.scopes,
        a.policy_id,
        a.max_concurrency,
        provisionedBy,
        a.template_id,
        a.template_version,
      ],
    );
    const id = ny.rows[0].id;

    await tx.query(
      `UPDATE agents SET status = 'canceled', revoked_at = now()
       WHERE id = $1 AND tenant_id = $2`,
      [agentId, tenantId],
    );

    // Samma två händelser som skapaAgentNyckel + sattAgentStatus skriver.
    await auditera(tx, tenantId, "agent_provisionerad", {
      agentId: id,
      module: a.module,
      scopes: a.scopes,
      displayName: a.display_name,
      provisionedBy,
    });
    await auditera(tx, tenantId, "agent_statusandrad", { agentId, status: "canceled" });

    return id;
  });

  return { agent_id: nyttId, nyckel, ersatte: agentId };
}

// --------------------------------------------------------------- hälsa

export type Halsa = {
  ko_djup: number;
  senaste_korning: string | null;
  /** Meddelanden som krävt omförsök (read_ct > 1) senaste dygnet. */
  omforsok_24h: number;
};

export async function halsa(db: PGlite): Promise<Halsa> {
  const djup = await new PgliteKo(db).depth();
  const r = await db.query<{ senaste: Date | string | null; omforsok: string }>(
    `SELECT max(archived_at) AS senaste,
            count(*) FILTER (
              WHERE read_ct > 1 AND enqueued_at > now() - interval '24 hours'
            ) AS omforsok
     FROM agent_jobs`,
  );
  const senaste = r.rows[0]?.senaste ?? null;
  return {
    ko_djup: djup,
    senaste_korning: senaste
      ? (senaste instanceof Date ? senaste : new Date(senaste)).toISOString()
      : null,
    omforsok_24h: Number(r.rows[0]?.omforsok ?? 0),
  };
}
