import type { PGlite } from "@electric-sql/pglite";
import type {
  Proposal,
  ProposalKind,
  ModuleId,
  LegalReference,
  DecisionOutcome,
} from "@/contracts";
import { withTenant } from "./db/tenant";
import { evaluateAutonomy, hamtaPolicy, type PolicyRad } from "./decisions";
import type { Flagga } from "./kontering";

// Adminkonsolens dataassemblering (WP6). Ren läsning — konsolen skriver
// aldrig själv i huvudboken; beslut går via decideProposal och policyer
// via sparaPolicy (decisions.ts). Poängen med kön är OMRÄKNING: diffen
// mot policy räknas mot GÄLLANDE policy vid varje hämtning, inte mot den
// som gällde när förslaget köades — ändrar konsulten policyn ändras diffen.

/** timestamptz kommer som Date från PGlite — API:t talar ISO-strängar. */
function tillIso(v: Date | string): string {
  return (v instanceof Date ? v : new Date(v)).toISOString();
}

export type KoRad = {
  id: string;
  module: ModuleId;
  kind: ProposalKind;
  summary: string;
  motpart: string | null;
  belopp_ore: number;
  confidence: number;
  hash: string;
  created_at: string;
  flaggor: Flagga[];
  legal: LegalReference[];
  /** Omräknad NU mot gällande policy — tom lista = förslaget skulle passera. */
  missade_villkor: string[];
};

export async function hamtaKo(db: PGlite, tenantId: string): Promise<KoRad[]> {
  // 1) Pending-förslag + känd-motpart-kollen i EN tenant-scopad transaktion
  //    (samma EXISTS-mönster som handleProposal — RLS begränsar till tenanten).
  const pending = await withTenant(db, tenantId, async (tx) => {
    const r = await tx.query<{
      id: string;
      payload: Proposal;
      flaggor: Flagga[];
      created_at: Date | string;
    }>(
      `SELECT id, payload, flaggor, created_at
       FROM proposals WHERE status = 'pending'
       ORDER BY created_at ASC, id`,
    );
    const rader: {
      id: string;
      payload: Proposal;
      flaggor: Flagga[];
      created_at: Date | string;
      kandMotpart: boolean;
    }[] = [];
    for (const row of r.rows) {
      const kandMotpart = row.payload.motpart
        ? await tx
            .query<{ finns: boolean }>(
              `SELECT EXISTS (SELECT 1 FROM verifications WHERE motpart = $1) AS finns`,
              [row.payload.motpart],
            )
            .then((x) => Boolean(x.rows[0]?.finns))
        : false;
      rader.push({ ...row, kandMotpart });
    }
    return rader;
  });

  // 2) GÄLLANDE policy per modul — hämtas nu, via samma hamtaPolicy som
  //    beslutsmotorn använder (egen withTenant, därför utanför tx ovan).
  const moduler = [...new Set(pending.map((p) => p.payload.module))];
  const policyer = new Map<string, PolicyRad | null>();
  for (const m of moduler) policyer.set(m, await hamtaPolicy(db, tenantId, m));

  // 3) Omräkningen — inte lagring: exakt samma evaluateAutonomy som vid
  //    POST, men mot dagens policy. Diffen är alltså alltid färsk.
  return pending.map((row) => {
    const p = row.payload;
    const utfall = evaluateAutonomy(p, policyer.get(p.module) ?? null, row.kandMotpart);
    return {
      id: row.id,
      module: p.module,
      kind: p.kind,
      summary: p.summary,
      motpart: p.motpart ?? null,
      belopp_ore: p.lines.reduce((s, l) => s + l.debet_ore, 0),
      confidence: p.confidence,
      hash: p.hash,
      created_at: tillIso(row.created_at),
      flaggor: row.flaggor,
      legal: p.legal,
      missade_villkor: utfall.missade,
    };
  });
}

export type LoggRad = {
  proposal_id: string;
  decided_at: string;
  outcome: DecisionOutcome;
  decided_by: string;
  verifikationsnummer: number | null;
  reason: string | null;
  summary: string;
  module: string;
  kind: ProposalKind;
  confidence: number;
  /** Ur payloadens provenance — AI Act-spårbarheten i loggen. */
  model: string;
  /** "openclaw@…" när förslaget kom via OpenClaw; null för interna körningar. */
  agent_runtime: string | null;
};

export async function hamtaBeslutslogg(
  db: PGlite,
  tenantId: string,
  limit = 50,
): Promise<LoggRad[]> {
  return withTenant(db, tenantId, async (tx) => {
    const r = await tx.query<{
      proposal_id: string;
      decided_at: Date | string;
      outcome: DecisionOutcome;
      decided_by: string;
      verifikationsnummer: number | null;
      reason: string | null;
      summary: string;
      module: string;
      kind: ProposalKind;
      confidence: string;
      model: string | null;
      agent_runtime: string | null;
    }>(
      `SELECT d.proposal_id, d.decided_at, d.outcome, d.decided_by,
              d.verifikationsnummer, d.reason,
              p.summary, p.module, p.kind, p.confidence,
              p.payload->'provenance'->>'model'         AS model,
              p.payload->'provenance'->>'agent_runtime' AS agent_runtime
       FROM decisions d
       JOIN proposals p ON p.id = d.proposal_id
       ORDER BY d.decided_at DESC
       LIMIT $1`,
      [limit],
    );
    return r.rows.map((row) => ({
      proposal_id: row.proposal_id,
      decided_at: tillIso(row.decided_at),
      outcome: row.outcome,
      decided_by: row.decided_by,
      verifikationsnummer:
        row.verifikationsnummer === null ? null : Number(row.verifikationsnummer),
      reason: row.reason,
      summary: row.summary,
      module: row.module,
      kind: row.kind,
      confidence: Number(row.confidence),
      model: row.model ?? "okänd",
      agent_runtime: row.agent_runtime,
    }));
  });
}

export async function hamtaPolicyer(db: PGlite, tenantId: string): Promise<PolicyRad[]> {
  return withTenant(db, tenantId, async (tx) => {
    const r = await tx.query<{
      module: string;
      max_belopp_ore: string;
      min_confidence: string;
      kanda_motparter_endast: boolean;
      tillatna_kinds: ProposalKind[];
    }>(
      `SELECT module, max_belopp_ore, min_confidence, kanda_motparter_endast, tillatna_kinds
       FROM autonomy_policies ORDER BY module`,
    );
    return r.rows.map((row) => ({
      tenant_id: tenantId,
      module: row.module,
      max_belopp_ore: Number(row.max_belopp_ore),
      min_confidence: Number(row.min_confidence),
      kanda_motparter_endast: row.kanda_motparter_endast,
      tillatna_kinds: row.tillatna_kinds,
    }));
  });
}
