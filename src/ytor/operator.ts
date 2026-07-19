import { randomBytes } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { sha256Hex, type ModuleId, type ProposalKind } from "@/contracts";
import { hamtaMallForMajor, aktivaBranschpaket, type BranschPaketId } from "@/mallar/registry";
import { provisionAgent, type ProvisioneradAgent } from "@/lib/provisioning";
import { auditera } from "@/lib/ledger";
import { PgliteKo } from "@/lib/queue";
import type { Scope } from "@/lib/decisions";

// Operatörskonsolen (WP14) — grundarens vy. Regeln som allt här lyder
// under: operatören ser AGGREGAT, aldrig innehåll. Antal förslag är drift;
// summary, belopp och motpart är byråns värld. Enda payload-läsningen i
// filen är mall_version i agentDetalj — ett MEDVETET undantag: fältet är
// driftmetadata, semver-tvingat av kontraktet vid porten (schema.ts) och
// kan inte bära fritext. Verifikationer läses aldrig.

/** timestamptz kommer som Date eller sträng beroende på driver — EN
 *  normalisering till ISO-sträng för hela filen. */
const tillIsoTid = (v: Date | string | null | undefined): string | null =>
  v == null ? null : (v instanceof Date ? v : new Date(v)).toISOString();

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

// ------------------------------------------------------- flottan (WP13)

/** Hårdkodad nu — görs konfigurerbar senare (kickoff WP13). Andelen
 *  räknas på (rejected + corrected) / förslag: båda är "konsulten höll
 *  inte med", före respektive efter bokföring. */
export const KORRIGERINGSTROSKEL = 0.3;

export type FlottVarning = "inaktiv_7d" | "hog_korrigeringsandel" | "versionsdrift";

export type FlottRad = {
  agent_id: string;
  byra: string;
  tenant_id: string;
  tenant_namn: string;
  display_name: string;
  module: string;
  /** Agentmall ur mallregistret — null = mall-lös modulagent. */
  template_id: string | null;
  /** Major-pekaren på agentraden ('1'). */
  template_version: string;
  /** Registrets aktuella exakta version för pekaren — null = mall-lös
   *  agent eller versionsdrift (major saknas i katalogen, ADR-0004). */
  mall_aktuell_version: string | null;
  /** Aktiva branschpaket (ADR-0005): snittet av vad mallen kan aktivera
   *  och vad tenantens branschmall pekar ut. Tom för mall-lösa agenter
   *  och branschneutrala roller. */
  branschpaket: BranschPaketId[];
  status: string;
  forslag_7d: number;
  auto_7d: number;
  rejected_7d: number;
  corrected_7d: number;
  /** null när förslag saknas — 0 % och "inget underlag" är olika saker. */
  andel_auto: number | null;
  andel_korrigerade: number | null;
  senaste_aktivitet: string | null;
  varningar: FlottVarning[];
  /** Antal förslag per 24-timmarsintervall bakåt från nu, äldst→nyast
   *  (7 platser) — sparkline-datat i översikten (WP27). Intervallen
   *  täcker EXAKT samma rullande 7-dygnsfönster som forslag_7d, så
   *  summan stämmer alltid med räknaren (granskningsfynd WP29:
   *  kalenderdygns-bucketing tappade fönstrets äldsta timmar och
   *  blandade databasens och JS:ets tidszoner). Ett ANTAL per intervall,
   *  aldrig innehåll. */
  forslag_dagar: number[];
};

/** Hela flottan ur agent_telemetry (service-vägen — operatören ser alla
 *  tenants). Samma innehållsregel som resten av filen: aggregat och
 *  driftmetadata, aldrig summary/belopp/motpart. */
export async function flottoversikt(db: PGlite): Promise<FlottRad[]> {
  const r = await db.query<{
    agent_id: string;
    byra: string | null;
    tenant_id: string;
    tenant_namn: string;
    display_name: string;
    module: string;
    template_id: string | null;
    template_version: string;
    tenant_mall: string;
    status: string;
    proposals_7d: string;
    auto_7d: string;
    rejected_7d: string;
    corrected_7d: string;
    last_activity: Date | string | null;
  }>(
    `SELECT t.agent_id, b.namn AS byra, t.tenant_id, tn.namn AS tenant_namn,
            t.display_name, t.module, t.template_id, t.template_version,
            tn.mall AS tenant_mall, t.status,
            t.proposals_7d, t.auto_7d, t.rejected_7d, t.corrected_7d, t.last_activity
     FROM agent_telemetry t
     JOIN tenants tn ON tn.id = t.tenant_id
     LEFT JOIN byraer b ON b.id = tn.byra_id
     ORDER BY b.namn NULLS LAST, tn.namn, t.display_name`,
  );

  // Sparkline-datat: antal förslag per agent och 24-timmarsintervall
  // bakåt från nu (0 = senaste dygnet … 6 = äldsta). Intervallen räknas
  // helt i SQL mot samma now() som fönstret — EN tidsauktoritet, ingen
  // tidszonssöm mot JS. Endast count — summary/belopp/motpart läses aldrig.
  const dagar = await db.query<{ agent_id: string; dygn_sedan: number; n: string }>(
    `SELECT agent_id,
            floor(extract(epoch FROM (now() - created_at)) / 86400)::int AS dygn_sedan,
            count(*) AS n
     FROM proposals
     WHERE agent_id IS NOT NULL AND created_at > now() - interval '7 days'
     GROUP BY agent_id, 2`,
  );
  const perAgentDygn = new Map<string, number[]>();
  for (const rad of dagar.rows) {
    let hinkar = perAgentDygn.get(rad.agent_id);
    if (!hinkar) perAgentDygn.set(rad.agent_id, (hinkar = Array(7).fill(0)));
    const i = Number(rad.dygn_sedan);
    if (i >= 0 && i < 7) hinkar[i] += Number(rad.n);
  }

  const nu = Date.now();
  return r.rows.map((rad) => {
    const forslag = Number(rad.proposals_7d);
    const auto = Number(rad.auto_7d);
    const rejected = Number(rad.rejected_7d);
    const corrected = Number(rad.corrected_7d);
    const mall = rad.template_id
      ? hamtaMallForMajor(rad.template_id, rad.template_version)
      : null;
    const senaste = rad.last_activity
      ? rad.last_activity instanceof Date
        ? rad.last_activity
        : new Date(rad.last_activity)
      : null;
    const andelKorr = forslag > 0 ? (rejected + corrected) / forslag : null;

    const varningar: FlottVarning[] = [];
    // Pausad/avslutad agent är väntat inaktiv — varningen gäller aktiva.
    if (rad.status === "active" && (!senaste || nu - senaste.getTime() > 7 * 86_400_000)) {
      varningar.push("inaktiv_7d");
    }
    if (andelKorr !== null && andelKorr > KORRIGERINGSTROSKEL) {
      varningar.push("hog_korrigeringsandel");
    }
    if (rad.template_id && !mall) varningar.push("versionsdrift");

    return {
      agent_id: rad.agent_id,
      byra: rad.byra ?? "(utan byrå)",
      tenant_id: rad.tenant_id,
      tenant_namn: rad.tenant_namn,
      display_name: rad.display_name,
      module: rad.module,
      template_id: rad.template_id,
      template_version: rad.template_version,
      mall_aktuell_version: mall?.version ?? null,
      // Tenant-kontexten aktiverar (ADR-0005) — härleds här, lagras aldrig
      // på agentraden. Versionsdriftade agenter visar inga paket: utan
      // registerdefinition vet vi inte vad mallen kan aktivera.
      branschpaket: mall ? aktivaBranschpaket(mall, rad.tenant_mall).map((p) => p.id) : [],
      status: rad.status,
      forslag_7d: forslag,
      auto_7d: auto,
      rejected_7d: rejected,
      corrected_7d: corrected,
      andel_auto: forslag > 0 ? auto / forslag : null,
      andel_korrigerade: andelKorr,
      senaste_aktivitet: tillIsoTid(senaste),
      varningar,
      // Äldst→nyast: plats 0 är 6–7 dygn sedan, plats 6 är senaste dygnet.
      forslag_dagar: (perAgentDygn.get(rad.agent_id) ?? Array(7).fill(0))
        .slice()
        .reverse(),
    };
  });
}

export type DetaljProposal = {
  id: string;
  kind: ProposalKind;
  status: string;
  confidence: number;
  /** Stämpeln ur payloaden — driftmetadata, inte innehåll. OBS: agentens
   *  EGEN utsaga (semver-tvingad vid porten), till skillnad från flottans
   *  versionsdrift-varning som räknas ur agentradens DB-sanning. */
  mall_version: string | null;
  skapad: string;
};

/** Livslinjens händelser (WP27) — driftmetadata ur audit_log, aldrig
 *  innehåll: bara VAD som hände med agenten och när. */
export type LivslinjeHandelse = "skapad" | "pausad" | "aterupptagen" | "avslutad";

export type AgentDetalj = {
  agent: FlottRad & { scopes: Scope[]; max_concurrency: number; provisioned_by: string; skapad: string };
  policy: {
    max_belopp_ore: number;
    min_confidence: number;
    kanda_motparter_endast: boolean;
    tillatna_kinds: ProposalKind[];
  } | null;
  /** Senaste 20 förslagen som DRIFTRADER: id, kind, status, konfidens och
   *  mallstämpel — aldrig summary, belopp, motpart eller payload-innehåll
   *  (operatörsregeln; innehållet är byråns värld). */
  senaste: DetaljProposal[];
  /** skapad → pausad → återupptagen … ur audit-händelserna. */
  livslinje: { tid: string; handelse: LivslinjeHandelse }[];
  /** Kö-djup och senaste worker-körning för AGENTENS tenant (WP27). */
  tenant_drift: { ko_djup: number; senaste_korning: string | null };
};

export async function agentDetalj(db: PGlite, agentId: string): Promise<AgentDetalj | null> {
  const flotta = await flottoversikt(db);
  const rad = flotta.find((a) => a.agent_id === agentId);
  if (!rad) return null;

  const a = await db.query<{
    scopes: Scope[];
    max_concurrency: number;
    provisioned_by: string;
    created_at: Date | string;
    policy_id: string | null;
  }>(
    `SELECT scopes, max_concurrency, provisioned_by, created_at, policy_id
     FROM agents WHERE id = $1`,
    [agentId],
  );
  const agentRad = a.rows[0];
  if (!agentRad) return null;

  // Policyn via agentens länk, med fallback till tenant+modul-raden —
  // samma uppslag som provisioneringen länkade mot.
  const p = await db.query<{
    max_belopp_ore: string;
    min_confidence: string;
    kanda_motparter_endast: boolean;
    tillatna_kinds: ProposalKind[];
  }>(
    agentRad.policy_id
      ? `SELECT max_belopp_ore, min_confidence, kanda_motparter_endast, tillatna_kinds
         FROM autonomy_policies WHERE id = $1`
      : `SELECT max_belopp_ore, min_confidence, kanda_motparter_endast, tillatna_kinds
         FROM autonomy_policies WHERE tenant_id = $1 AND module = $2`,
    agentRad.policy_id ? [agentRad.policy_id] : [rad.tenant_id, rad.module],
  );
  const policy = p.rows[0]
    ? {
        max_belopp_ore: Number(p.rows[0].max_belopp_ore),
        min_confidence: Number(p.rows[0].min_confidence),
        kanda_motparter_endast: p.rows[0].kanda_motparter_endast,
        tillatna_kinds: p.rows[0].tillatna_kinds,
      }
    : null;

  // Tre oberoende läsningar — parallellt, inte i rad (granskningsfynd
  // WP29): senaste förslagen, livslinjen och tenantens driftläge.
  const [s, liv, drift] = await Promise.all([
    db.query<{
      id: string;
      kind: ProposalKind;
      status: string;
      confidence: string;
      mall_version: string | null;
      created_at: Date | string;
    }>(
      `SELECT id, kind, status, confidence,
              payload->>'mall_version' AS mall_version, created_at
       FROM proposals WHERE agent_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [agentId],
    ),
    // Livslinjen ur audit_log: provisionerad + statusändringar för
    // agenten. Payload-läsningen är agentId/status — driftfält, aldrig
    // innehåll. OBS kontraktet: nyckeln 'agentId' skrivs av auditera-
    // anropen i agent-auth.ts och roteraNyckel ovan — byter de stavning
    // tystnar livslinjen. id som ordningsutjämnare: händelser i samma
    // transaktion delar created_at (granskningsfynd WP29).
    db.query<{ event_type: string; status: string | null; tid: Date | string }>(
      `SELECT event_type, payload->>'status' AS status, created_at AS tid
       FROM audit_log
       WHERE payload->>'agentId' = $1
         AND event_type IN ('agent_provisionerad', 'agent_statusandrad')
       ORDER BY created_at, id`,
      [agentId],
    ),
    // Tenantens driftläge: kö-djup nu + senaste worker-körning — jobben
    // pekar på tenanten via message-kuvertet (payload_ref läses aldrig).
    // OBS: läser agent_jobs-tabellen direkt (som halsa) — byts kön mot
    // pgmq i Supabase följer dessa aggregat med i adapterbytet.
    db.query<{ djup: string; senaste: Date | string | null }>(
      `SELECT count(*) FILTER (WHERE archived_at IS NULL) AS djup,
              max(archived_at) AS senaste
       FROM agent_jobs WHERE message->>'tenant_id' = $1`,
      [rad.tenant_id],
    ),
  ]);

  const STATUS_TILL_HANDELSE: Record<string, LivslinjeHandelse> = {
    paused: "pausad",
    active: "aterupptagen",
    canceled: "avslutad",
  };
  const livslinje = liv.rows.flatMap((h) => {
    const handelse =
      h.event_type === "agent_provisionerad"
        ? ("skapad" as const)
        : STATUS_TILL_HANDELSE[h.status ?? ""];
    // Okänd status (framtida livscykelsteg) hoppar vi över medvetet —
    // hellre en lucka än en gissad etikett.
    if (!handelse) return [];
    return [{ tid: tillIsoTid(h.tid)!, handelse }];
  });

  return {
    agent: {
      ...rad,
      scopes: agentRad.scopes,
      max_concurrency: Number(agentRad.max_concurrency),
      provisioned_by: agentRad.provisioned_by,
      skapad: tillIsoTid(agentRad.created_at)!,
    },
    policy,
    senaste: s.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      confidence: Number(row.confidence),
      mall_version: row.mall_version,
      skapad: tillIsoTid(row.created_at)!,
    })),
    livslinje,
    tenant_drift: {
      ko_djup: Number(drift.rows[0]?.djup ?? 0),
      senaste_korning: tillIsoTid(drift.rows[0]?.senaste),
    },
  };
}

// --------------------------------------------------------------- hälsa

export type Halsa = {
  ko_djup: number;
  senaste_korning: string | null;
  /** Meddelanden som krävt omförsök (read_ct > 1) senaste dygnet. */
  omforsok_24h: number;
  /** Äldsta oarkiverade jobbets enqueued_at — null när kön är tom (WP27). */
  aldsta_vantande: string | null;
  /** Kö-djup och omförsök per modul — drift, aldrig innehåll (WP27). */
  per_modul: { module: string; ko_djup: number; omforsok_24h: number }[];
  /** Intagskanalen (WP24): underlag per vecka och källa senaste 8
   *  veckorna — aggregat över alla tenants, ALDRIG innehåll. */
  intag_per_vecka: { vecka: string; kalla: string; antal: number }[];
};

export async function halsa(db: PGlite): Promise<Halsa> {
  const djup = await new PgliteKo(db).depth();
  const r = await db.query<{
    senaste: Date | string | null;
    aldsta: Date | string | null;
    omforsok: string;
  }>(
    `SELECT max(archived_at) AS senaste,
            min(enqueued_at) FILTER (WHERE archived_at IS NULL) AS aldsta,
            count(*) FILTER (
              WHERE read_ct > 1 AND enqueued_at > now() - interval '24 hours'
            ) AS omforsok
     FROM agent_jobs`,
  );
  // Per modul ur jobbkuvertet (message->>'module' är driftmetadata) —
  // endast moduler med något att visa.
  const moduler = await db.query<{ module: string | null; ko_djup: string; omforsok: string }>(
    `SELECT message->>'module' AS module,
            count(*) FILTER (WHERE archived_at IS NULL) AS ko_djup,
            count(*) FILTER (
              WHERE read_ct > 1 AND enqueued_at > now() - interval '24 hours'
            ) AS omforsok
     FROM agent_jobs
     GROUP BY message->>'module'
     ORDER BY message->>'module'`,
  );
  // Intagsaggregatet (WP24) läses på service-vägen som övrig drift —
  // veckor och källor, aldrig en rad kundinnehåll.
  const intag = await db.query<{ vecka: Date | string; kalla: string; antal: string }>(
    `SELECT date_trunc('week', skapad)::date AS vecka, kalla, count(*) AS antal
     FROM underlag
     WHERE skapad > now() - interval '8 weeks'
     GROUP BY 1, 2
     ORDER BY 1 DESC, 2`,
  );

  return {
    ko_djup: djup,
    senaste_korning: tillIsoTid(r.rows[0]?.senaste),
    omforsok_24h: Number(r.rows[0]?.omforsok ?? 0),
    aldsta_vantande: tillIsoTid(r.rows[0]?.aldsta),
    per_modul: moduler.rows
      .map((m) => ({
        module: m.module ?? "(okänd)",
        ko_djup: Number(m.ko_djup),
        omforsok_24h: Number(m.omforsok),
      }))
      .filter((m) => m.ko_djup > 0 || m.omforsok_24h > 0),
    intag_per_vecka: intag.rows.map((i) => ({
      vecka: (i.vecka instanceof Date ? i.vecka : new Date(i.vecka))
        .toISOString()
        .slice(0, 10),
      kalla: i.kalla,
      antal: Number(i.antal),
    })),
  };
}
