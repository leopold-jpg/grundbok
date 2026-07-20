import type { PGlite } from "@electric-sql/pglite";
import { propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import { withTenant } from "@/lib/db/tenant";
import { auditera } from "@/lib/ledger";
import { kontrolleraInjection } from "@/lib/policy";
import { formateraOre } from "@/modules/radgivning";

// Modul: kundassistent (WP22, masterplanen) — kundappens chatt.
// Rådgivningens MASKINERI (principal-tänk, injection-screening,
// spårbarhet) med SNÄVARE scopes: svarar ENDAST om kundens egna
// underlag och verifikat — aldrig redovisnings- eller skatteråd; det är
// byråns roll och relation. Rådgivningsfrågor får ett erbjudande om
// eskalering ("vill du att jag skickar frågan till din revisor?") som
// blir ett ärende i byråns kö med underlaget länkat.
//
// Medvetet DETERMINISTISK (ingen LLM i v1): statusfrågor och
// fakturauppslag är exakta frågor mot egen data — och gränsen "aldrig
// råd" ska inte bero på en modells omdöme. Varje svar auditeras
// (AI Act-spårbarhet i audit_log; kontraktets ModuleId rörs inte —
// kärnan ändras inte i S3).

export const KUNDASSISTENT_VERSION = "0.1.0";

export type KundassistentSvar = {
  svar: string;
  typ: "status" | "faktura" | "moms" | "radgivning_avbojd" | "vet_ej";
  erbjud_eskalering: boolean;
  /** Underlaget svaret handlar om — appen länkar det vid eskalering. */
  underlag_id: string | null;
};

// Rådgivningsmönstren prövas FÖRST: "får jag dra av …" ska avböjas även
// om frågan också nämner moms eller en motpart. Mönstren är breda med
// flit — hellre en onödig eskalering än ett råd ur appen.
const RADGIVNING_RE =
  /(ska (jag|vi)|bör (jag|vi)|hur (bokför|konterar|deklarerar)|får (jag|man|vi)|avdrag|avdragsgill|momssats|vilken moms|skattefri|skatteregler|förmån|representation|periodiser|k10|3:12|utdelning|deklaration)/i;

const STATUS_RE =
  /(har ni (fått|tagit emot)|status|var är|kommit (fram|in)|mottagit|hur går det|vad händer med)/i;

const MOMS_RE = /hur mycket moms|moms(en)? (i|för|under|denna|den här)/i;

const MANADER = [
  "januari", "februari", "mars", "april", "maj", "juni",
  "juli", "augusti", "september", "oktober", "november", "december",
] as const;

/** Månad ur frågan ("i mars") → {ar, manad} — innevarande år antas;
 *  en framtida månad tolkas som föregående år. */
function manadUrFraga(fraga: string, nu: Date): { ar: number; manad: number } | null {
  const lag = fraga.toLowerCase();
  for (let i = 0; i < MANADER.length; i++) {
    if (lag.includes(MANADER[i])) {
      const ar = i > nu.getMonth() ? nu.getFullYear() - 1 : nu.getFullYear();
      return { ar, manad: i + 1 };
    }
  }
  return null;
}

export async function svaraPaKundfraga(
  db: PGlite,
  input: { tenantId: string; fraga: string; stalldAv: string },
): Promise<KundassistentSvar> {
  return propagateAttributes(
    {
      traceName: "kundassistent-fraga",
      userId: input.tenantId,
      metadata: { tenant_id: input.tenantId, agent_id: "modul:kundassistent" },
      tags: ["kundassistent"],
    },
    () =>
      startActiveObservation("kundassistent-fraga", async (span) => {
        const svar = await svaraInner(db, input);
        span.update({
          input: { fraga_langd: input.fraga.length },
          output: { typ: svar.typ, erbjud_eskalering: svar.erbjud_eskalering },
        });
        return svar;
      }),
  );
}

async function svaraInner(
  db: PGlite,
  input: { tenantId: string; fraga: string; stalldAv: string },
): Promise<KundassistentSvar> {
  const fraga = input.fraga.trim();
  if (!fraga) throw new Error("Frågan får inte vara tom");

  // Frågan är untrusted input — screenas och behandlas som data (samma
  // princip som rådgivningen); fynd stoppar inte flödet men auditeras.
  const injektionsfynd = kontrolleraInjection(fraga);
  const nu = new Date();

  const svar = await withTenant(db, input.tenantId, async (tx) => {
    // 1) Rådgivningsvakten — appens hårda gräns.
    if (RADGIVNING_RE.test(fraga)) {
      return {
        svar:
          "Den frågan är rådgivning, och den ska din revisor svara på — " +
          "jag kan bara berätta om era egna underlag och verifikat. " +
          "Vill du att jag skickar frågan till din revisor?",
        typ: "radgivning_avbojd",
        erbjud_eskalering: true,
        underlag_id: null,
      } as const;
    }

    // 2) Statusfrågor: läget i intake-kedjan, ur samma härledning som
    //    historiklistan (proposal/decision — ingen egen statemaskin).
    if (STATUS_RE.test(fraga)) {
      // Samma härledning som historiklistan (intake.ts): bokfört kräver
      // verifikation; avvisat/kvitterat utan ledger-effekt är "hanterat"
      // — det räknas ALDRIG som väntande (granskningsfynd).
      const r = await tx.query<{
        mottagna: string;
        tolkade: string;
        bokforda: string;
        hanterade: string;
      }>(
        `SELECT
           count(*) FILTER (WHERE p.id IS NULL) AS mottagna,
           count(*) FILTER (WHERE p.status = 'pending') AS tolkade,
           count(*) FILTER (WHERE v.nummer IS NOT NULL) AS bokforda,
           count(*) FILTER (WHERE v.nummer IS NULL
             AND p.status IN ('approved', 'auto_approved', 'rejected')) AS hanterade
         FROM underlag u
         LEFT JOIN LATERAL (
           SELECT p.id, p.status FROM proposals p
           WHERE p.payload->'provenance'->'input_refs' ? ('document:' || u.document_id::text)
           ORDER BY p.created_at DESC LIMIT 1
         ) p ON true
         LEFT JOIN LATERAL (
           SELECT v.nummer FROM verifications v WHERE v.proposal_id = p.id LIMIT 1
         ) v ON true`,
      );
      const rad = r.rows[0];
      const mottagna = Number(rad?.mottagna ?? 0);
      const tolkade = Number(rad?.tolkade ?? 0);
      const bokforda = Number(rad?.bokforda ?? 0);
      const hanterade = Number(rad?.hanterade ?? 0);
      const totalt = mottagna + tolkade + bokforda + hanterade;
      return {
        svar:
          totalt === 0
            ? "Ni har inte lämnat in något underlag ännu — fota ett kvitto under Skicka in så syns det här direkt."
            : `Ni har lämnat in ${totalt} underlag totalt: ${bokforda} bokförda, ` +
              `${tolkade} tolkade som väntar hos byrån och ${mottagna} mottagna som väntar på tolkning.` +
              (hanterade > 0
                ? ` ${hanterade} har byrån hanterat utan bokföring — hör av dig om du undrar varför.`
                : ""),
        typ: "status",
        erbjud_eskalering: false,
        underlag_id: null,
      } as const;
    }

    // 3) Momsfrågor: SUMMAN ur egna verifikat (fakta, inte råd).
    if (MOMS_RE.test(fraga)) {
      const period = manadUrFraga(fraga, nu) ?? {
        ar: nu.getFullYear(),
        manad: nu.getMonth() + 1,
      };
      const r = await tx.query<{ ingaende: string; utgaende: string }>(
        `SELECT
           COALESCE(SUM(CASE WHEN vr.konto LIKE '264%' THEN vr.debet_ore - vr.kredit_ore ELSE 0 END), 0) AS ingaende,
           COALESCE(SUM(CASE WHEN vr.konto LIKE '261%' OR vr.konto LIKE '262%' OR vr.konto LIKE '263%'
             THEN vr.kredit_ore - vr.debet_ore ELSE 0 END), 0) AS utgaende
         FROM verification_rows vr
         JOIN verifications v ON v.id = vr.verification_id
         WHERE date_part('year', v.affarshandelsedatum) = $1
           AND date_part('month', v.affarshandelsedatum) = $2`,
        [period.ar, period.manad],
      );
      const ingaende = Number(r.rows[0]?.ingaende ?? 0);
      const utgaende = Number(r.rows[0]?.utgaende ?? 0);
      const namn = `${MANADER[period.manad - 1]} ${period.ar}`;
      return {
        svar:
          ingaende === 0 && utgaende === 0
            ? `Inga bokförda momsbelopp i ${namn} ännu.`
            : `I ${namn} är ${formateraOre(ingaende)} ingående moms bokförd` +
              (utgaende !== 0 ? ` och ${formateraOre(utgaende)} utgående` : "") +
              ". Siffrorna kommer ur era bokförda verifikat.",
        typ: "moms",
        erbjud_eskalering: false,
        underlag_id: null,
      } as const;
    }

    // 4) Fakturauppslag: motpart (+ ev. månad) mot egna underlag och
    //    verifikat. Motpartskandidater hämtas ur egen data — frågan
    //    matchas mot dem, aldrig tvärtom (ingen fritext-SQL).
    const period = manadUrFraga(fraga, nu);
    const motparter = await tx.query<{ motpart: string }>(
      `SELECT DISTINCT motpart FROM verifications
       UNION
       SELECT DISTINCT p.payload->>'motpart' AS motpart FROM proposals p
       WHERE p.payload->>'motpart' IS NOT NULL`,
    );
    const lagFraga = fraga.toLowerCase();
    const traff = motparter.rows
      .map((r) => r.motpart)
      .filter((m) => m && m !== "—")
      // Längsta träffen vinner: "Kafferosteriet Exempel AB" före "AB".
      .sort((a, b) => b.length - a.length)
      .find((m) => {
        const ord = m.toLowerCase().split(/\s+/)[0];
        return ord.length >= 3 && lagFraga.includes(ord);
      });

    if (traff) {
      const r = await tx.query<{
        underlag_id: string | null;
        summary: string;
        belopp: string;
        datum: Date | string;
        nummer: number | null;
        status: string;
      }>(
        `SELECT u.id AS underlag_id, p.summary,
                (SELECT COALESCE(SUM((l->>'debet_ore')::bigint), 0)
                   FROM jsonb_array_elements(p.payload->'lines') l) AS belopp,
                (p.payload->>'affarshandelsedatum')::date AS datum,
                v.nummer, p.status
         FROM proposals p
         LEFT JOIN verifications v ON v.proposal_id = p.id
         LEFT JOIN underlag u
           ON p.payload->'provenance'->'input_refs' ? ('document:' || u.document_id::text)
         WHERE p.payload->>'motpart' = $1
           AND ($2::int IS NULL OR (date_part('year', (p.payload->>'affarshandelsedatum')::date) = $2
             AND date_part('month', (p.payload->>'affarshandelsedatum')::date) = $3))
         ORDER BY (p.payload->>'affarshandelsedatum')::date DESC
         LIMIT 1`,
        [traff, period?.ar ?? null, period?.manad ?? null],
      );
      const rad = r.rows[0];
      if (rad) {
        const datum = (rad.datum instanceof Date ? rad.datum : new Date(rad.datum))
          .toISOString()
          .slice(0, 10);
        // Bokförd kräver verifikation; approved advisory (kvitterad
        // eskalering) och rejected är båda "hanterad av byrån".
        const lage =
          rad.nummer !== null
            ? `bokförd som verifikation ${rad.nummer}`
            : rad.status === "pending"
              ? "hos byrån för attest"
              : "hanterad av byrån";
        return {
          svar:
            `${traff}, ${datum}: ${rad.summary} — ${formateraOre(Number(rad.belopp))}, ${lage}.` +
            (period ? "" : " (Senaste posten — nämn en månad för en specifik.)"),
          typ: "faktura",
          erbjud_eskalering: false,
          underlag_id: rad.underlag_id,
        } as const;
      }
      return {
        svar:
          `Jag hittar ingen post från ${traff}` +
          (period ? ` i ${MANADER[period.manad - 1]}` : "") +
          ". Vill du att jag skickar frågan till din revisor?",
        typ: "vet_ej",
        erbjud_eskalering: true,
        underlag_id: null,
      } as const;
    }

    // 5) Ärligt "vet ej" + eskaleringserbjudande — aldrig en gissning.
    return {
      svar:
        "Jag kan bara svara på frågor om era egna underlag och verifikat " +
        "(\"har ni fått kvittot?\", \"vad var fakturan från X i mars?\", " +
        "\"hur mycket moms i juni?\"). Vill du att jag skickar frågan till din revisor?",
      typ: "vet_ej",
      erbjud_eskalering: true,
      underlag_id: null,
    } as const;
  });

  await withTenant(db, input.tenantId, (tx) =>
    auditera(tx, input.tenantId, "kundassistent_svar", {
      fraga,
      typ: svar.typ,
      svar: svar.svar,
      stalldAv: input.stalldAv,
      modulVersion: KUNDASSISTENT_VERSION,
      injektionsfynd: injektionsfynd.length,
    }),
  );

  return svar;
}

// ------------------------------------------------------- eskaleringen

export type KundfragaRad = {
  id: string;
  fraga: string;
  underlag_id: string | null;
  underlag_summary: string | null;
  status: "open" | "besvarad";
  svar: string | null;
  skapad: string;
  besvarad: string | null;
};

/** "Vill du att jag skickar frågan till din revisor?" → ärende i byråns
 *  kö med underlaget länkat. Underlags-id:t valideras genom RLS (samma
 *  dokument-tenant-vakt-princip som intaget) — en annan tenants id är
 *  osynligt och länken vägras. */
export async function eskaleraKundfraga(
  db: PGlite,
  input: { tenantId: string; fraga: string; underlagId?: string | null; stalldAv: string },
): Promise<{ id: string }> {
  const fraga = input.fraga.trim();
  if (!fraga) throw new Error("Frågan får inte vara tom");
  return withTenant(db, input.tenantId, async (tx) => {
    let underlagId: string | null = null;
    if (input.underlagId) {
      const finns = await tx.query(`SELECT 1 FROM underlag WHERE id = $1`, [input.underlagId]);
      if (!finns.rows[0]) throw new Error("Underlaget finns inte");
      underlagId = input.underlagId;
    }
    const r = await tx.query<{ id: string }>(
      `INSERT INTO kundfragor (tenant_id, fraga, underlag_id, stalld_av)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.tenantId, fraga.slice(0, 2000), underlagId, input.stalldAv],
    );
    await auditera(tx, input.tenantId, "kundfraga_eskalerad", {
      kundfragaId: r.rows[0].id,
      fraga,
      underlagId,
      stalldAv: input.stalldAv,
    });
    return r.rows[0];
  });
}

/** Frågelistan — appens "Frågor hos byrån" och byråns flik "Frågor". */
export async function listaKundfragor(db: PGlite, tenantId: string): Promise<KundfragaRad[]> {
  return withTenant(db, tenantId, async (tx) => {
    const r = await tx.query<{
      id: string;
      fraga: string;
      underlag_id: string | null;
      underlag_summary: string | null;
      status: "open" | "besvarad";
      svar: string | null;
      skapad: Date | string;
      besvarad: Date | string | null;
    }>(
      `SELECT k.id, k.fraga, k.underlag_id, k.status, k.svar, k.skapad, k.besvarad,
              p.summary AS underlag_summary
       FROM kundfragor k
       LEFT JOIN underlag u ON u.id = k.underlag_id
       LEFT JOIN LATERAL (
         SELECT p.summary FROM proposals p
         WHERE p.payload->'provenance'->'input_refs' ? ('document:' || u.document_id::text)
         ORDER BY p.created_at DESC LIMIT 1
       ) p ON true
       ORDER BY (k.status = 'besvarad'), k.skapad DESC`,
    );
    const iso = (v: Date | string | null) =>
      v === null ? null : (v instanceof Date ? v : new Date(v)).toISOString();
    return r.rows.map((rad) => ({
      ...rad,
      skapad: iso(rad.skapad)!,
      besvarad: iso(rad.besvarad),
    }));
  });
}

/** Byråns svar (WP24): raden blir besvarad och kedjan auditeras —
 *  svaret syns i kundens app vid nästa poll. */
export async function besvaraKundfraga(
  db: PGlite,
  input: { tenantId: string; fragaId: string; svar: string; besvaradAv: string },
): Promise<void> {
  const svar = input.svar.trim();
  if (!svar) throw new Error("Svaret får inte vara tomt");
  await withTenant(db, input.tenantId, async (tx) => {
    const r = await tx.query<{ fraga: string }>(
      `UPDATE kundfragor SET status = 'besvarad', svar = $2, besvarad_av = $3, besvarad = now()
       WHERE id = $1 AND status = 'open' RETURNING fraga`,
      [input.fragaId, svar, input.besvaradAv],
    );
    if (!r.rows[0]) throw new Error("Frågan finns inte eller är redan besvarad");
    await auditera(tx, input.tenantId, "kundfraga_besvarad", {
      kundfragaId: input.fragaId,
      fraga: r.rows[0].fraga,
      svar,
      besvaradAv: input.besvaradAv,
    });
  });
}
