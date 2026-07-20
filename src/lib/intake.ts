import type { PGlite } from "@electric-sql/pglite";
import { sha256Hex } from "@/contracts";
import { withTenant } from "./db/tenant";
import { auditera } from "./ledger";
import { PgliteKo } from "./queue";
import { verifieraAgentNyckel } from "./agent-auth";
import { kravKlient } from "@/auth/session";

// Intake-porten (WP21, ADR-0002): ALLA kanaler är dumma kurirer in till
// samma port — app, mejl, api. Ingen kanal har egen väg till tolkning
// eller ledger: porten skapar underlag + dokument, lägger ett jobb i
// kön, och den BEFINTLIGA workern kör buildProposal genom handleProposal
// precis som för alla andra. Status är härledd ur proposal/decision —
// ingen egen statemaskin.

export type IntakeKalla = "app" | "mejl" | "api" | "telegram";

export type IntakeInnehall =
  | { typ: "text"; text: string }
  | { typ: "fil"; base64: string; mime: string; filnamn?: string };

/** Tillåtna binärformat (foto/PDF). Allt annat avvisas vid porten. */
const TILLATNA_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);
const MAX_TEXT = 100_000;
/** ~8 MB binärt (base64 är ~4/3 av det). */
const MAX_BASE64 = 11_000_000;

export type IntakeUtfall = {
  underlag_id: string;
  status: "mottaget";
  dubblett: boolean;
  jobb_koat: boolean;
  notis: string | null;
};

// MEDVETEN AVVIKELSE från kickoffens "presignerad uppladdning till
// storage": lokalt ÄR documents-tabellen storagen (workern löser redan
// "document:<uuid>" ur den), så filen tas emot som base64 och lagras
// som data-URI i documents.raw. Vid deploy (S4) byts detta mot
// presignerad Supabase Storage-URL bakom SAMMA port — payload_ref är
// redan en storage-URI-abstraktion, så bytet rör inte kedjan.
function normaliseraInnehall(innehall: IntakeInnehall): {
  raw: string;
  dokumentTyp: string;
  filnamn: string | null;
  mime: string | null;
} {
  if (innehall.typ === "text") {
    const text = innehall.text?.trim() ?? "";
    if (!text) throw new IntakeFel(400, "underlaget är tomt");
    if (text.length > MAX_TEXT) {
      throw new IntakeFel(413, `texten är för lång (max ${MAX_TEXT} tecken)`);
    }
    return { raw: text, dokumentTyp: "text", filnamn: null, mime: null };
  }

  const mime = innehall.mime?.toLowerCase().trim() ?? "";
  if (!TILLATNA_MIME.has(mime)) {
    throw new IntakeFel(415, `filtypen stöds inte (${mime || "okänd"}) — foto eller PDF`);
  }
  const base64 = (innehall.base64 ?? "").replace(/\s/g, "");
  if (!base64) throw new IntakeFel(400, "filen är tom");
  if (base64.length > MAX_BASE64) throw new IntakeFel(413, "filen är för stor (max ~8 MB)");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new IntakeFel(400, "filen är inte giltig base64");
  }
  return {
    raw: `data:${mime};base64,${base64}`,
    dokumentTyp: mime === "application/pdf" ? "pdf" : "foto",
    filnamn: innehall.filnamn?.slice(0, 200) ?? null,
    mime,
  };
}

/** HTTP-nära fel med statuskod — porten översätter till svar. */
export class IntakeFel extends Error {
  constructor(
    public http: 400 | 413 | 415,
    meddelande: string,
  ) {
    super(meddelande);
  }
}

/**
 * Kärnfunktionen: underlag in → dokument + kvittensrad + jobb i kön.
 * Idempotens via content-hash: samma innehåll två gånger ger EN rad
 * (dubblett: true) och köar aldrig ett nytt jobb — förslagssidan är
 * dessutom dubbelt skyddad av workerns deterministiska proposal-id.
 */
export async function taEmotUnderlag(
  db: PGlite,
  input: {
    tenantId: string;
    kalla: IntakeKalla;
    /** Vem som lämnade in — "klient:<uid>", "agent:<namn>" eller "mejl:<adress>". */
    inlamnadAv: string;
    innehall: IntakeInnehall;
  },
): Promise<IntakeUtfall> {
  const { raw, dokumentTyp, filnamn, mime } = normaliseraInnehall(input.innehall);
  const contentHash = sha256Hex(raw);

  // Aktiv bokföringsagent slås upp FÖRE transaktionen (service-vägen,
  // samma läsning som cron-lagret): jobbet i kön bär agentens identitet.
  const agent = await db.query<{ id: string }>(
    `SELECT id FROM agents
     WHERE tenant_id = $1 AND module = 'bokforing' AND status = 'active'
     ORDER BY created_at LIMIT 1`,
    [input.tenantId],
  );
  const agentId = agent.rows[0]?.id ?? null;

  type TxUtfall =
    | { dubblett: true; underlagId: string; documentId: string }
    | { dubblett: false; underlagId: string; documentId: string };

  const utfall = await withTenant(db, input.tenantId, async (tx): Promise<TxUtfall> => {
    const befintlig = await tx.query<{ id: string; document_id: string }>(
      `SELECT id, document_id FROM underlag WHERE content_hash = $1`,
      [contentHash],
    );
    if (befintlig.rows[0]) {
      await auditera(tx, input.tenantId, "underlag_dubblett", {
        underlagId: befintlig.rows[0].id,
        kalla: input.kalla,
        inlamnadAv: input.inlamnadAv,
      });
      return {
        dubblett: true,
        underlagId: befintlig.rows[0].id,
        documentId: befintlig.rows[0].document_id,
      };
    }

    const dok = await tx.query<{ id: string }>(
      `INSERT INTO documents (tenant_id, raw, typ) VALUES ($1, $2, $3) RETURNING id`,
      [input.tenantId, raw, dokumentTyp],
    );
    const rad = await tx.query<{ id: string }>(
      `INSERT INTO underlag
         (tenant_id, document_id, kalla, content_hash, filnamn, mime_typ, inlamnad_av)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [input.tenantId, dok.rows[0].id, input.kalla, contentHash, filnamn, mime, input.inlamnadAv],
    );
    await auditera(tx, input.tenantId, "underlag_mottaget", {
      underlagId: rad.rows[0].id,
      documentId: dok.rows[0].id,
      kalla: input.kalla,
      typ: dokumentTyp,
      filnamn,
      inlamnadAv: input.inlamnadAv,
      jobbKoat: agentId !== null,
    });
    return { dubblett: false, underlagId: rad.rows[0].id, documentId: dok.rows[0].id };
  }).catch(async (err) => {
    // Kapplöpning mot unikindexet: två samtidiga uppladdningar av samma
    // innehåll — förloraren läser om och svarar dubblett.
    if (err instanceof Error && /underlag_tenant_hash_idx/.test(err.message)) {
      const igen = await withTenant(db, input.tenantId, (tx) =>
        tx.query<{ id: string; document_id: string }>(
          `SELECT id, document_id FROM underlag WHERE content_hash = $1`,
          [contentHash],
        ),
      );
      if (igen.rows[0]) {
        return {
          dubblett: true,
          underlagId: igen.rows[0].id,
          documentId: igen.rows[0].document_id,
        } as const;
      }
    }
    throw err;
  });

  if (utfall.dubblett) {
    // Läkningsvägen (granskningsfynd): ett strandat underlag — inget
    // förslag och inget levande jobb (agenten saknades/var pausad vid
    // uppladdningen, eller kön gav upp) — får ett NYTT jobb när samma
    // innehåll skickas igen. Omköningen är idempotent hela vägen:
    // deterministiskt job_id → uuid v5-proposal-id → duplicate i porten.
    let jobbKoat = false;
    let notis = "Samma underlag är redan inlämnat — det behandlas bara en gång.";
    const harForslag = await withTenant(db, input.tenantId, (tx) =>
      tx
        .query(
          `SELECT 1 FROM proposals p
           WHERE p.payload->'provenance'->'input_refs' ? ('document:' || $1::text)
           LIMIT 1`,
          [utfall.documentId],
        )
        .then((r) => Boolean(r.rows[0])),
    );
    if (!harForslag) {
      const levandeJobb = await db.query(
        `SELECT 1 FROM agent_jobs
         WHERE archived_at IS NULL AND message->>'job_id' = $1`,
        [`intake:${utfall.underlagId}`],
      );
      if (levandeJobb.rows[0]) {
        notis = "Samma underlag är redan inlämnat — tolkningen pågår.";
      } else if (agentId) {
        await new PgliteKo(db).send({
          job_id: `intake:${utfall.underlagId}`,
          tenant_id: input.tenantId,
          agent_id: agentId,
          module: "bokforing",
          trigger: `intake:${input.kalla}:omforsok`,
          payload_ref: `document:${utfall.documentId}`,
        });
        await withTenant(db, input.tenantId, (tx) =>
          auditera(tx, input.tenantId, "underlag_omkoat", {
            underlagId: utfall.underlagId,
            kalla: input.kalla,
            inlamnadAv: input.inlamnadAv,
          }),
        );
        jobbKoat = true;
        notis = "Samma underlag är redan inlämnat — vi har startat om hanteringen.";
      } else {
        notis = "Mottaget sedan tidigare. Tolkningen startar när er byrå aktiverat bokföringen.";
      }
    }
    return {
      underlag_id: utfall.underlagId,
      status: "mottaget",
      dubblett: true,
      jobb_koat: jobbKoat,
      notis,
    };
  }

  // Kön efter commit: ett jobb får aldrig peka på ocommittat underlag.
  // job_id är deterministiskt ur underlagsraden → workerns uuid v5 ger
  // idempotenta proposal-id:n även om jobbet skulle köas om.
  let jobbKoat = false;
  if (agentId) {
    await new PgliteKo(db).send({
      job_id: `intake:${utfall.underlagId}`,
      tenant_id: input.tenantId,
      agent_id: agentId,
      module: "bokforing",
      trigger: `intake:${input.kalla}`,
      payload_ref: `document:${utfall.documentId}`,
    });
    jobbKoat = true;
  }

  return {
    underlag_id: utfall.underlagId,
    status: "mottaget",
    dubblett: false,
    jobb_koat: jobbKoat,
    notis: jobbKoat
      ? null
      : "Mottaget. Tolkningen startar när er byrå aktiverat bokföringen.",
  };
}

// ------------------------------------------------------- statusresan

// "hanterad" (granskningsfynd): byrån har avgjort förslaget utan
// ledger-effekt — avvisat, eller kvitterat en eskalering (advisory).
// Utan det fjärde läget ljuger resan dubbelt: ett avvisat underlag ser
// ut att vänta för evigt, och en attesterad eskalering stämplas
// "Bokfört" fast ingenting finns i huvudboken.
export type UnderlagStatus = "mottaget" | "tolkat" | "bokfort" | "hanterad";

export type UnderlagRad = {
  id: string;
  kalla: IntakeKalla;
  filnamn: string | null;
  skapad: string;
  status: UnderlagStatus;
  /** Stämpeltider för resan — null tills respektive steg nåtts. */
  tolkat_at: string | null;
  bokfort_at: string | null;
  motpart: string | null;
  summary: string | null;
  belopp_ore: number | null;
  verifikationsnummer: number | null;
};

function tillIso(v: Date | string | null): string | null {
  if (v === null) return null;
  return (v instanceof Date ? v : new Date(v)).toISOString();
}

type UnderlagDbRad = {
  id: string;
  kalla: IntakeKalla;
  filnamn: string | null;
  skapad: Date | string;
  proposal_id: string | null;
  proposal_status: string | null;
  proposal_skapad: Date | string | null;
  summary: string | null;
  motpart: string | null;
  belopp_ore: string | null;
  verifikationsnummer: number | null;
  bokfort_at: Date | string | null;
};

// Statusen HÄRLEDS (kickoff WP21): bokfört när ett beslut skrivit
// verifikation (eller advisory-godkänts), tolkat när ett förslag
// refererar dokumentet, annars mottaget. Förslaget hittas via
// provenance.input_refs — samma referens som binder förslaget till sitt
// underlag i revisionsspåret.
const UNDERLAG_SQL = `
  SELECT u.id, u.kalla, u.filnamn, u.skapad,
         p.id AS proposal_id, p.status AS proposal_status,
         p.created_at AS proposal_skapad, p.summary,
         p.payload->>'motpart' AS motpart,
         (SELECT COALESCE(SUM((l->>'debet_ore')::bigint), 0)
            FROM jsonb_array_elements(p.payload->'lines') l) AS belopp_ore,
         v.nummer AS verifikationsnummer,
         d.decided_at AS bokfort_at
  FROM underlag u
  LEFT JOIN LATERAL (
    SELECT p.* FROM proposals p
    WHERE p.payload->'provenance'->'input_refs' ? ('document:' || u.document_id::text)
    ORDER BY p.created_at DESC LIMIT 1
  ) p ON true
  LEFT JOIN LATERAL (
    SELECT v.nummer FROM verifications v WHERE v.proposal_id = p.id LIMIT 1
  ) v ON true
  LEFT JOIN LATERAL (
    SELECT d.decided_at FROM decisions d
    WHERE d.proposal_id = p.id AND d.outcome IN ('approved', 'auto_approved')
    ORDER BY d.decided_at DESC LIMIT 1
  ) d ON true
`;

function tillUnderlagRad(row: UnderlagDbRad): UnderlagRad {
  // Bokfört kräver en VERKLIG verifikation — ett beslut utan
  // ledger-effekt (avvisning, kvitterad eskalering) är "hanterad".
  const bokford = row.verifikationsnummer !== null;
  const hanterad =
    !bokford &&
    (row.proposal_status === "rejected" ||
      row.proposal_status === "approved" ||
      row.proposal_status === "auto_approved");
  const status: UnderlagStatus = bokford
    ? "bokfort"
    : hanterad
      ? "hanterad"
      : row.proposal_id
        ? "tolkat"
        : "mottaget";
  return {
    id: row.id,
    kalla: row.kalla,
    filnamn: row.filnamn,
    skapad: tillIso(row.skapad)!,
    status,
    tolkat_at: tillIso(row.proposal_skapad),
    bokfort_at: bokford ? tillIso(row.bokfort_at) : null,
    motpart: row.motpart,
    summary: row.summary,
    belopp_ore: row.belopp_ore === null ? null : Number(row.belopp_ore),
    verifikationsnummer:
      row.verifikationsnummer === null ? null : Number(row.verifikationsnummer),
  };
}

/** Klientens historik — tenant-scopad genom withTenant/RLS: en annan
 *  tenants underlag är per konstruktion osynligt. */
export async function listaUnderlag(
  db: PGlite,
  tenantId: string,
  limit = 200,
): Promise<UnderlagRad[]> {
  return withTenant(db, tenantId, async (tx) => {
    const r = await tx.query<UnderlagDbRad>(
      `${UNDERLAG_SQL} ORDER BY u.skapad DESC, u.id LIMIT $1`,
      [limit],
    );
    return r.rows.map(tillUnderlagRad);
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ett enskilt underlag — null om det inte finns FÖR TENANTEN (samma
 *  dokument-tenant-vakt-princip som Bugbot-fixen: RLS avgör, och en
 *  annan tenants underlag-id ser ut exakt som ett påhittat id → 404). */
export async function hamtaUnderlagDetalj(
  db: PGlite,
  tenantId: string,
  underlagId: string,
): Promise<UnderlagRad | null> {
  if (!UUID_RE.test(underlagId)) return null;
  return withTenant(db, tenantId, async (tx) => {
    const r = await tx.query<UnderlagDbRad>(`${UNDERLAG_SQL} WHERE u.id = $1`, [underlagId]);
    return r.rows[0] ? tillUnderlagRad(r.rows[0]) : null;
  });
}

// ------------------------------------------------------- läget (WP22)

export type LagesSiffror = {
  inlamnat_manad: number;
  /** mottaget + tolkat — INTE hanterade/avvisade: de väntar på inget. */
  vantar: number;
  senast_bokfort: {
    summary: string | null;
    motpart: string | null;
    bokfort_at: string | null;
    verifikationsnummer: number | null;
  } | null;
};

/** Kundappens hemsiffror, räknade i SQL över ALLA underlag (aldrig ett
 *  list-tak) — obestridliga eller inte alls. */
export async function lagesSiffror(db: PGlite, tenantId: string): Promise<LagesSiffror> {
  return withTenant(db, tenantId, async (tx) => {
    const r = await tx.query<{ inlamnat_manad: string; vantar: string }>(
      `SELECT
         count(*) FILTER (WHERE u.skapad >= date_trunc('month', now())) AS inlamnat_manad,
         count(*) FILTER (
           WHERE v.nummer IS NULL
             AND (p.status IS NULL OR p.status = 'pending')
         ) AS vantar
       FROM underlag u
       LEFT JOIN LATERAL (
         SELECT p.status, p.id FROM proposals p
         WHERE p.payload->'provenance'->'input_refs' ? ('document:' || u.document_id::text)
         ORDER BY p.created_at DESC LIMIT 1
       ) p ON true
       LEFT JOIN LATERAL (
         SELECT v.nummer FROM verifications v WHERE v.proposal_id = p.id LIMIT 1
       ) v ON true`,
    );
    const senast = await tx.query<{
      summary: string | null;
      motpart: string | null;
      bokfort_at: Date | string | null;
      nummer: number | null;
    }>(
      `SELECT p.summary, p.payload->>'motpart' AS motpart,
              d.decided_at AS bokfort_at, v.nummer
       FROM underlag u
       JOIN LATERAL (
         SELECT p.* FROM proposals p
         WHERE p.payload->'provenance'->'input_refs' ? ('document:' || u.document_id::text)
         ORDER BY p.created_at DESC LIMIT 1
       ) p ON true
       JOIN verifications v ON v.proposal_id = p.id
       LEFT JOIN LATERAL (
         SELECT d.decided_at FROM decisions d
         WHERE d.proposal_id = p.id AND d.outcome IN ('approved', 'auto_approved')
         ORDER BY d.decided_at DESC LIMIT 1
       ) d ON true
       ORDER BY d.decided_at DESC NULLS LAST
       LIMIT 1`,
    );
    const s = senast.rows[0];
    return {
      inlamnat_manad: Number(r.rows[0]?.inlamnat_manad ?? 0),
      vantar: Number(r.rows[0]?.vantar ?? 0),
      senast_bokfort: s
        ? {
            summary: s.summary,
            motpart: s.motpart,
            bokfort_at: tillIso(s.bokfort_at),
            verifikationsnummer: s.nummer === null ? null : Number(s.nummer),
          }
        : null,
    };
  });
}

// ------------------------------------------------------- HTTP-porten

export type IntakePortSvar = { http: number; body: unknown };

/**
 * Hela HTTP-porten som testbar funktion (samma mönster som
 * proposalsPort): auth via klientsession ELLER tenant-scopad agentnyckel
 * med intake:write. Tenanten kommer ALLTID ur principalen — aldrig ur
 * payloaden.
 */
export async function intakePort(db: PGlite, req: Request): Promise<IntakePortSvar> {
  let tenantId: string;
  let kalla: IntakeKalla;
  let inlamnadAv: string;

  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const nyckel = await verifieraAgentNyckel(db, authHeader);
    if (nyckel.typ === "okand") {
      return { http: 401, body: { fel: "giltig agentnyckel krävs (Authorization: Bearer gk_…)" } };
    }
    if (nyckel.typ === "inaktiv") {
      return {
        http: 403,
        body: {
          fel: `agenten är ${nyckel.status === "paused" ? "pausad" : "avslutad"} — kontakta er konsult`,
        },
      };
    }
    if (!nyckel.principal.scopes.includes("intake:write")) {
      return { http: 403, body: { fel: "scope intake:write saknas för nyckeln" } };
    }
    tenantId = nyckel.principal.tenant_id;
    kalla = "api";
    inlamnadAv = nyckel.principal.namn;
  } else {
    const krav = await kravKlient(db, req);
    if ("http" in krav) return { http: krav.http, body: { fel: krav.fel } };
    tenantId = krav.tenantId;
    kalla = "app";
    inlamnadAv = `klient:${krav.session.user.id}`;
  }

  const body = (await req.json().catch(() => null)) as {
    text?: string;
    fil?: { base64?: string; mime?: string; filnamn?: string };
  } | null;
  if (!body || (body.text === undefined) === (body.fil === undefined)) {
    return { http: 400, body: { fel: "exakt ett av text eller fil krävs" } };
  }

  const innehall: IntakeInnehall =
    body.text !== undefined
      ? { typ: "text", text: body.text }
      : {
          typ: "fil",
          base64: body.fil!.base64 ?? "",
          mime: body.fil!.mime ?? "",
          filnamn: body.fil!.filnamn,
        };

  try {
    const utfall = await taEmotUnderlag(db, { tenantId, kalla, inlamnadAv, innehall });
    return { http: utfall.dubblett ? 200 : 201, body: utfall };
  } catch (err) {
    if (err instanceof IntakeFel) return { http: err.http, body: { fel: err.message } };
    throw err;
  }
}
