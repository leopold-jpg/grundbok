import type { PGlite, Transaction } from "@electric-sql/pglite";
import {
  ProposalSchema,
  hashProposal,
  type Proposal,
  type ProposalKind,
  type ModuleId,
} from "@/contracts";
import { withTenant } from "./db/tenant";
import { kontrolleraInjection, evaluate } from "./policy";
import { auditera, skrivVerifikation, type SkrivenVerifikation } from "./ledger";
import type { Flagga } from "./kontering";

// Beslutsmotorn — kärnans enda väg från förslag till huvudbok (ADR-0002).
// Autonomi är en policyinställning i KÄRNAN (autonomy_policies-tabellen),
// aldrig en egenskap hos agenten. Allt som inte matchar policyn hamnar i
// godkännandekön och väntar på ett hash-bundet mänskligt beslut.

export type Scope = "proposals:write" | "ledger:read" | "documents:read";

/** Vem som anropar: intern UI-route eller extern agent via API-nyckel. */
export type Principal = {
  typ: "intern" | "agent_nyckel";
  tenant_id: string;
  module: ModuleId | "*"; // intern UI får "*"; agentnycklar är modulbundna
  scopes: Scope[];
  namn: string;
  /** Agentradens id när anroparen är en agent (WP12): porten stämplar
   *  proposals.agent_id ur principalen — telemetrin litar aldrig på
   *  payloadens egen utsaga om vem som byggde förslaget. */
  agent_id?: string;
};

export type PolicyRad = {
  tenant_id: string;
  module: string;
  max_belopp_ore: number;
  min_confidence: number;
  kanda_motparter_endast: boolean;
  tillatna_kinds: ProposalKind[];
};

export type AutonomiUtfall = { auto: boolean; missade: string[] };

/**
 * Ren, testbar funktion: matchar ett förslag mot tenantens autonomipolicy.
 * `missade` listar exakt vilka villkor som inte uppfylldes — adminkonsolens
 * "diff mot policy". Hård regel utanför policyn: en correction kan aldrig
 * auto-godkännas — rättelser av bokförda poster kräver alltid människa.
 */
export function evaluateAutonomy(
  proposal: Proposal,
  policy: PolicyRad | null,
  kandMotpart: boolean,
): AutonomiUtfall {
  const missade: string[] = [];

  if (proposal.kind === "correction") {
    missade.push("correction auto-godkänns aldrig — rättelser kräver människa");
  }
  if (!policy) {
    missade.push(`ingen autonomipolicy för modulen ${proposal.module}`);
    return { auto: false, missade };
  }
  if (!policy.tillatna_kinds.includes(proposal.kind)) {
    missade.push(`kind "${proposal.kind}" ingår inte i policyns tillåtna kinds`);
  }
  if (proposal.confidence < policy.min_confidence) {
    missade.push(
      `confidence ${proposal.confidence.toFixed(2)} under policyns minimum ${policy.min_confidence}`,
    );
  }
  const belopp = proposal.lines.reduce((s, r) => s + r.debet_ore, 0);
  if (belopp > policy.max_belopp_ore) {
    missade.push(
      `belopp ${belopp} ören över policyns maximum ${policy.max_belopp_ore}`,
    );
  }
  if (policy.kanda_motparter_endast && !kandMotpart) {
    missade.push("policyn kräver känd motpart (tidigare bokförd hos tenanten)");
  }
  return { auto: missade.length === 0, missade };
}

export type ProposalResultat =
  | { status: "avvisad_vid_porten"; http: 403 | 422; fel: string[] }
  | { status: "duplicate"; proposal_id: string; befintlig_status: string }
  | { status: "pending"; proposal_id: string; missade_villkor: string[]; flaggor: Flagga[] }
  | {
      status: "auto_approved";
      proposal_id: string;
      flaggor: Flagga[];
      verifikation: SkrivenVerifikation | null;
    };

/**
 * Hela porten in i kärnan: schema → principal → hash → injection-screening
 * → idempotens → policy → (auto-bokföring | kö). Samma funktion bär både
 * POST /api/proposals (externa agenter, WP4-nycklar) och de interna
 * UI-routsen — det finns ingen sidodörr.
 */
export async function handleProposal(
  db: PGlite,
  principal: Principal,
  raw: unknown,
  /** Granskningsflaggor från BETRODDA runtime-lager (workern, interna
   *  routes) — WP32. Aldrig från payloaden: en extern agents egen utsaga
   *  om sina flaggor är värdelös som kontroll. Persisteras i
   *  proposals.flaggor tillsammans med portens egna. */
  runtimeFlaggor: Flagga[] = [],
): Promise<ProposalResultat> {
  const parsed = ProposalSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "avvisad_vid_porten",
      http: 422,
      fel: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  const p = parsed.data as Proposal;

  if (!principal.scopes.includes("proposals:write")) {
    return { status: "avvisad_vid_porten", http: 403, fel: ["scope proposals:write saknas"] };
  }
  if (principal.tenant_id !== p.tenant_id) {
    return {
      status: "avvisad_vid_porten",
      http: 403,
      fel: [`principalens tenant (${principal.tenant_id}) matchar inte förslagets (${p.tenant_id})`],
    };
  }
  if (principal.module !== "*" && principal.module !== p.module) {
    return {
      status: "avvisad_vid_porten",
      http: 403,
      fel: [`principalens modul (${principal.module}) matchar inte förslagets (${p.module})`],
    };
  }
  if (hashProposal(p) !== p.hash) {
    return {
      status: "avvisad_vid_porten",
      http: 422,
      fel: ["hashverifieringen föll: payload matchar inte hash — förslaget avvisas"],
    };
  }

  // Injection-screening i kärnan oavsett vad agenten intygar (försvar i
  // djupled — v1:s svenska+engelska mönster återanvänds).
  const fritext = [
    p.summary,
    p.motpart ?? "",
    ...p.lines.map((l) => l.benamning),
    ...p.legal.map((l) => l.note ?? ""),
  ].join("\n");
  const flaggor: Flagga[] = [
    // Runtime-lagrets granskningsflaggor först (dedupliceras på id) …
    ...new Map(runtimeFlaggor.map((f) => [f.id, f])).values(),
    // … sedan portens egen injection-screening.
    ...kontrolleraInjection(fritext).map((f) => ({
      id: `injection_${f.monster}`,
      niva: "varning" as const,
      text: `Förslaget innehåller text som liknar en instruktion till systemet ("${f.utdrag}"). Behandlad som data — granska.`,
    })),
  ];
  if (!p.provenance.injection_screened) {
    flaggor.push({
      id: "agent_utan_screening",
      niva: "info",
      text: "Agenten intygar ingen egen injection-screening av underlaget.",
    });
  }

  return withTenant(db, principal.tenant_id, async (tx) => {
    // Idempotens: agentens uuid är nyckeln — dubbel-POST ger referensen
    // till det befintliga förslaget, aldrig ett nytt.
    const befintlig = await tx.query<{ id: string; status: string }>(
      `SELECT id, status FROM proposals WHERE id = $1`,
      [p.id],
    );
    if (befintlig.rows[0]) {
      return {
        status: "duplicate",
        proposal_id: p.id,
        befintlig_status: befintlig.rows[0].status,
      } as const;
    }

    const kandMotpart = p.motpart
      ? await tx
          .query<{ finns: boolean }>(
            `SELECT EXISTS (SELECT 1 FROM verifications WHERE motpart = $1) AS finns`,
            [p.motpart],
          )
          .then((r) => Boolean(r.rows[0]?.finns))
      : false;

    const policyRad = await tx.query<{
      max_belopp_ore: string;
      min_confidence: string;
      kanda_motparter_endast: boolean;
      tillatna_kinds: ProposalKind[];
    }>(
      `SELECT max_belopp_ore, min_confidence, kanda_motparter_endast, tillatna_kinds
       FROM autonomy_policies WHERE module = $1`,
      [p.module],
    );
    const policy: PolicyRad | null = policyRad.rows[0]
      ? {
          tenant_id: p.tenant_id,
          module: p.module,
          max_belopp_ore: Number(policyRad.rows[0].max_belopp_ore),
          min_confidence: Number(policyRad.rows[0].min_confidence),
          kanda_motparter_endast: policyRad.rows[0].kanda_motparter_endast,
          tillatna_kinds: policyRad.rows[0].tillatna_kinds,
        }
      : null;

    const utfall = evaluateAutonomy(p, policy, kandMotpart);
    const status = utfall.auto ? "auto_approved" : "pending";

    await tx.query(
      `INSERT INTO proposals
         (id, tenant_id, module, kind, batch_id, payload, hash, confidence, summary, status, flaggor, agent_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        p.id,
        p.tenant_id,
        p.module,
        p.kind,
        p.batch_id ?? null,
        JSON.stringify(p),
        p.hash,
        p.confidence,
        p.summary,
        status,
        JSON.stringify(flaggor),
        principal.agent_id ?? null,
      ],
    );

    // Telemetrisignalen för beloppsanomali (fall 7) skrivs HÄR — efter
    // idempotenskontrollen och i samma transaktion som förslaget: en
    // kö-omkörning av samma jobb blir 'duplicate' ovan och kan aldrig
    // lämna dubbla anomalihändelser i den append-only-loggen.
    const anomali = flaggor.find((f) => f.id === "anomaly_amount");
    if (anomali) {
      await auditera(tx, p.tenant_id, "telemetri_anomaly_amount", {
        proposalId: p.id,
        ...(anomali.data ?? {}),
      });
    }

    // Underlagsjakten (WP33): ett missing_receipt-flaggat förslag skapar
    // automatiskt en kompletteringsrad — restbeloppet jagas hos kunden i
    // byråvyns "Väntar på kunden", aldrig i konsultens huvud.
    const saknat = flaggor.find((f) => f.id === "missing_receipt");
    if (saknat) {
      await tx.query(
        `INSERT INTO kompletteringar
           (tenant_id, agent_id, proposal_id, typ, belopp_ore, beskrivning)
         VALUES ($1, $2, $3, 'missing_receipt', $4, $5)`,
        [
          p.tenant_id,
          principal.agent_id ?? null,
          p.id,
          typeof saknat.data?.restbelopp_ore === "number" ? saknat.data.restbelopp_ore : null,
          saknat.text,
        ],
      );
    }

    if (!utfall.auto) {
      await auditera(tx, p.tenant_id, "forslag_i_ko", {
        proposalId: p.id,
        module: p.module,
        kind: p.kind,
        principal: principal.namn,
        missadeVillkor: utfall.missade,
      });
      return {
        status: "pending",
        proposal_id: p.id,
        missade_villkor: utfall.missade,
        flaggor,
      } as const;
    }

    const verifikation = await bokforOmLedgerVerkande(tx, p);
    await tx.query(
      `INSERT INTO decisions
         (tenant_id, proposal_id, proposal_hash, outcome, decided_by, verifikationsnummer)
       VALUES ($1, $2, $3, 'auto_approved', $4, $5)`,
      [p.tenant_id, p.id, p.hash, `policy:${p.tenant_id}/${p.module}`, verifikation?.nummer ?? null],
    );
    await auditera(tx, p.tenant_id, "forslag_auto_godkant", {
      proposalId: p.id,
      module: p.module,
      kind: p.kind,
      principal: principal.namn,
      verifikationsnummer: verifikation?.nummer ?? null,
    });
    return { status: "auto_approved", proposal_id: p.id, flaggor, verifikation } as const;
  });
}

export type BeslutsUtfall =
  | { outcome: "approved"; verifikation: SkrivenVerifikation | null }
  | { outcome: "rejected" };

/**
 * Det mänskliga beslutet — hash-bundet: payloaden läses ur databasen,
 * hashen räknas OM och jämförs mot den lagrade. Har payloaden rörts efter
 * att förslaget skapades vägrar kärnan. v1:s rena policy-gate (evaluate)
 * återanvänds som sista kontroll före ledger-skrivningen.
 */
export async function decideProposal(
  db: PGlite,
  input: {
    tenantId: string;
    proposalId: string;
    outcome: "approved" | "rejected";
    decidedBy: string;
    reason?: string;
  },
): Promise<BeslutsUtfall> {
  return withTenant(db, input.tenantId, async (tx) => {
    const rad = await tx.query<{
      id: string;
      payload: Proposal;
      hash: string;
      status: string;
    }>(`SELECT id, payload, hash, status FROM proposals WHERE id = $1`, [input.proposalId]);
    const row = rad.rows[0];
    if (!row) throw new Error("Förslaget finns inte (eller tillhör en annan tenant)");
    if (row.status !== "pending") throw new Error(`Förslaget är redan ${row.status}`);

    const omraknad = hashProposal(row.payload);
    if (omraknad !== row.hash) {
      throw new Error(
        "Förslagets payload matchar inte dess hash — förslaget har manipulerats och kan inte beslutas",
      );
    }

    if (input.outcome === "rejected") {
      if (!input.reason?.trim()) {
        throw new Error("Avvisning kräver en motivering (reason)");
      }
      await tx.query(
        `INSERT INTO decisions (tenant_id, proposal_id, proposal_hash, outcome, decided_by, reason)
         VALUES ($1, $2, $3, 'rejected', $4, $5)`,
        [input.tenantId, input.proposalId, omraknad, input.decidedBy, input.reason],
      );
      await tx.query(`UPDATE proposals SET status = 'rejected' WHERE id = $1`, [input.proposalId]);
      await auditera(tx, input.tenantId, "forslag_avvisat", {
        proposalId: input.proposalId,
        decidedBy: input.decidedBy,
        reason: input.reason,
      });
      return { outcome: "rejected" } as const;
    }

    const gate = evaluate({
      handling: "registrera_verifikation",
      tenantId: input.tenantId,
      kontextTenantId: input.tenantId,
      roll: "konsult",
      godkannande: {
        beslut: "godkand",
        suggestionHash: omraknad,
        godkandAv: input.decidedBy,
      },
      aktuellForslagsHash: omraknad,
    });
    if (gate.beslut === "neka") throw new Error(`Policy-motorn nekade: ${gate.skal}`);

    const verifikation = await bokforOmLedgerVerkande(tx, row.payload);
    await tx.query(
      `INSERT INTO decisions
         (tenant_id, proposal_id, proposal_hash, outcome, decided_by, verifikationsnummer)
       VALUES ($1, $2, $3, 'approved', $4, $5)`,
      [input.tenantId, input.proposalId, omraknad, input.decidedBy, verifikation?.nummer ?? null],
    );
    await tx.query(`UPDATE proposals SET status = 'approved' WHERE id = $1`, [input.proposalId]);
    await auditera(tx, input.tenantId, "forslag_godkant", {
      proposalId: input.proposalId,
      decidedBy: input.decidedBy,
      verifikationsnummer: verifikation?.nummer ?? null,
    });
    return { outcome: "approved", verifikation } as const;
  });
}

/** advisory_answer har ingen ledger-effekt; allt annat blir verifikation. */
async function bokforOmLedgerVerkande(
  tx: Transaction,
  p: Proposal,
): Promise<SkrivenVerifikation | null> {
  if (p.lines.length === 0) return null;

  const rattarRef = p.provenance.input_refs
    .find((r) => r.startsWith("verification:"))
    ?.slice("verification:".length);

  // input_refs är agentens underlagsreferenser (storage-URI:er). Endast
  // "document:<uuid>" som faktiskt finns i kärnans documents-tabell blir
  // FK-länk — externa referenser lever vidare i payload/provenance.
  let dokumentRef = p.provenance.input_refs
    .find((r) => r.startsWith("document:"))
    ?.slice("document:".length);
  if (dokumentRef) {
    const finns = await tx.query(`SELECT 1 FROM documents WHERE id = $1`, [dokumentRef]);
    if (!finns.rows[0]) dokumentRef = undefined;
  }

  // Skill-versioner ur legal-referensernas rulesets ("se/moms@1.0.0").
  const skillVersions: Record<string, string> = {};
  for (const ref of p.legal) {
    const [skill, version] = ref.ruleset.split("@");
    if (skill && version) skillVersions[skill] = version;
  }

  return skrivVerifikation(tx, p.tenant_id, {
    affarshandelsedatum: p.affarshandelsedatum,
    beskrivning: p.summary,
    motpart: p.motpart ?? "—",
    lines: p.lines,
    proposalId: p.id,
    underlagDocumentId: dokumentRef ?? null,
    rattarVerifikation: p.kind === "correction" ? rattarRef : null,
    skillVersions,
  });
}

/** Policy-CRUD för adminkonsolen (WP6). */
export async function hamtaPolicy(
  db: PGlite,
  tenantId: string,
  module: string,
): Promise<PolicyRad | null> {
  return withTenant(db, tenantId, async (tx) => {
    const r = await tx.query<{
      max_belopp_ore: string;
      min_confidence: string;
      kanda_motparter_endast: boolean;
      tillatna_kinds: ProposalKind[];
    }>(
      `SELECT max_belopp_ore, min_confidence, kanda_motparter_endast, tillatna_kinds
       FROM autonomy_policies WHERE module = $1`,
      [module],
    );
    if (!r.rows[0]) return null;
    return {
      tenant_id: tenantId,
      module,
      max_belopp_ore: Number(r.rows[0].max_belopp_ore),
      min_confidence: Number(r.rows[0].min_confidence),
      kanda_motparter_endast: r.rows[0].kanda_motparter_endast,
      tillatna_kinds: r.rows[0].tillatna_kinds,
    };
  });
}

export async function sparaPolicy(db: PGlite, policy: PolicyRad): Promise<void> {
  await withTenant(db, policy.tenant_id, async (tx) => {
    await tx.query(
      `INSERT INTO autonomy_policies
         (tenant_id, module, max_belopp_ore, min_confidence, kanda_motparter_endast, tillatna_kinds, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (tenant_id, module) DO UPDATE SET
         max_belopp_ore = EXCLUDED.max_belopp_ore,
         min_confidence = EXCLUDED.min_confidence,
         kanda_motparter_endast = EXCLUDED.kanda_motparter_endast,
         tillatna_kinds = EXCLUDED.tillatna_kinds,
         updated_at = now()`,
      [
        policy.tenant_id,
        policy.module,
        policy.max_belopp_ore,
        policy.min_confidence,
        policy.kanda_motparter_endast,
        JSON.stringify(policy.tillatna_kinds),
      ],
    );
    await auditera(tx, policy.tenant_id, "autonomipolicy_andrad", {
      module: policy.module,
      policy: {
        max_belopp_ore: policy.max_belopp_ore,
        min_confidence: policy.min_confidence,
        kanda_motparter_endast: policy.kanda_motparter_endast,
        tillatna_kinds: policy.tillatna_kinds,
      },
    });
  });
}
