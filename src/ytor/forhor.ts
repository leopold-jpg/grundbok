import type { PGlite } from "@electric-sql/pglite";
import type { Proposal, ProposalKind, LegalReference, ModuleId } from "@/contracts";
import { withTenant } from "@/lib/db/tenant";
import { evaluateAutonomy, hamtaPolicy, type PolicyRad } from "@/lib/decisions";
import {
  aktivaBranschpaket,
  branschpaketRegistret,
  hamtaMall,
  paketForTenantMall,
  type MallRegel,
} from "@/mallar/registry";
import type { Flagga } from "@/lib/kontering";

// Förhörschatten, lager 1 (WP40): "Varför?"-panelens dataassemblering.
// DETERMINISTISK läsning ur befintliga tabeller — ingen LLM-runda, inga
// nya kontraktsfält. Samma scopning som resten av byråytan: tenant via
// withTenant/RLS, byrå-vakten bor i routen. Panelen svarar på konsultens
// "varför?" med det som redan finns: agentens motivering (summary,
// flaggor, lagrum, provenance), de branschpaketsregler som var aktiva,
// policyutfallet omräknat mot GÄLLANDE policy (samma motor som kön) och
// motpartens senaste historik hos tenanten.

export type ForhorsPaket = {
  id: string;
  displayName: string;
  version: string;
  regler: MallRegel[];
};

export type ForhorsHistorikRad = {
  typ: "verifikation" | "forslag";
  /** Verifikat: affärshändelsedatum. Förslag: skapandedatum (ISO). */
  datum: string;
  beskrivning: string;
  belopp_ore: number;
  /** Största debetkontot — kostnadskontot för ett normalt inköp. */
  konto: string | null;
  utfall: "policybeslut" | "attesterad" | "bokförd" | "väntar på attest" | "avvisad";
  verifikationsnummer: number | null;
};

export type ForhorsUnderlag = {
  proposal: {
    id: string;
    summary: string;
    module: ModuleId;
    kind: ProposalKind;
    status: string;
    confidence: number;
    motpart: string | null;
    affarshandelsedatum: string;
    created_at: string;
    flaggor: Flagga[];
    legal: LegalReference[];
    provenance: {
      model: string;
      /** "bokforing@1.1.0" när förslaget bär mallstämpeln (v0.3), annars null. */
      mall: string | null;
      agent_runtime: string | null;
      injection_screened: boolean;
    };
  };
  /** Policyutfallet omräknat NU mot gällande policy — exakt samma
   *  evaluateAutonomy som kön och porten. Tom missade-lista = inom policyn. */
  policyutfall: {
    missade_villkor: string[];
    policy: PolicyRad | null;
  };
  /** Branschpaketen som var aktiva för förslaget: mallstämplade förslag
   *  ger snittet mall∩tenant (aktivaBranschpaket); ostämplade (v0.2)
   *  faller tillbaka på tenantens bransch — samma fallback som
   *  granskningsmotorn (granskning.ts). */
  paket: ForhorsPaket[];
  /** De 3 senaste verifikaten/förslagen från samma motpart hos samma
   *  tenant, nyast först. Tom när motpart saknas. */
  historik: ForhorsHistorikRad[];
};

function tillIso(v: Date | string): string {
  return (v instanceof Date ? v : new Date(v)).toISOString();
}

/** Bygger hela Varför-underlaget. null = förslaget finns inte hos
 *  tenanten (RLS gör en annan tenants förslag osynligt — routen svarar
 *  404 utan att skilja fallen åt). */
export async function forhorsUnderlag(
  db: PGlite,
  tenantId: string,
  proposalId: string,
): Promise<ForhorsUnderlag | null> {
  // Tenantens bransch (paketaktiveringsnyckeln) — samma uppslag som
  // granskningsmotorn gör när kontexten saknas.
  const tenant = await db.query<{ namn: string; mall: string }>(
    `SELECT namn, mall FROM tenants WHERE id = $1`,
    [tenantId],
  );
  const tenantMall = tenant.rows[0]?.mall ?? "";

  const last = await withTenant(db, tenantId, async (tx) => {
    const p = await tx.query<{
      payload: Proposal;
      status: string;
      flaggor: Flagga[];
      created_at: Date | string;
    }>(
      `SELECT payload, status, flaggor, created_at FROM proposals WHERE id = $1`,
      [proposalId],
    );
    const rad = p.rows[0];
    if (!rad) return null;

    const motpart = rad.payload.motpart ?? null;

    // Känd motpart — samma EXISTS som kön/porten (kravet i policyn).
    const kandMotpart = motpart
      ? await tx
          .query<{ finns: boolean }>(
            `SELECT EXISTS (SELECT 1 FROM verifications WHERE motpart = $1) AS finns`,
            [motpart],
          )
          .then((r) => Boolean(r.rows[0]?.finns))
      : false;

    // Motpartshistoriken: bokförda verifikat + öppna/avvisade förslag.
    // Attesterade förslag syns via sin verifikation — aldrig dubbelt.
    const verifikat = motpart
      ? await tx.query<{
          nummer: number;
          affarshandelsedatum: Date | string;
          sammanstalld_at: Date | string;
          beskrivning: string;
          belopp_ore: string | null;
          konto: string | null;
          outcome: string | null;
        }>(
          `SELECT v.nummer, v.affarshandelsedatum, v.sammanstalld_at, v.beskrivning,
                  (SELECT sum(r.debet_ore) FROM verification_rows r
                    WHERE r.verification_id = v.id) AS belopp_ore,
                  (SELECT r.konto FROM verification_rows r
                    WHERE r.verification_id = v.id AND r.debet_ore > 0
                    ORDER BY r.debet_ore DESC LIMIT 1) AS konto,
                  (SELECT d.outcome FROM decisions d
                    WHERE d.proposal_id = v.proposal_id
                    ORDER BY d.decided_at DESC LIMIT 1) AS outcome
           FROM verifications v
           WHERE v.motpart = $1
             AND (v.proposal_id IS NULL OR v.proposal_id <> $2)
           ORDER BY v.sammanstalld_at DESC
           LIMIT 3`,
          [motpart, proposalId],
        )
      : { rows: [] };

    const forslag = motpart
      ? await tx.query<{
          summary: string;
          created_at: Date | string;
          status: string;
          payload: Proposal;
        }>(
          `SELECT summary, created_at, status, payload
           FROM proposals
           WHERE id <> $2 AND payload->>'motpart' = $1
             AND status IN ('pending', 'rejected')
           ORDER BY created_at DESC
           LIMIT 3`,
          [motpart, proposalId],
        )
      : { rows: [] };

    return { rad, kandMotpart, verifikat: verifikat.rows, forslag: forslag.rows };
  });

  if (!last) return null;
  const payload = last.rad.payload;

  // Policyutfallet mot GÄLLANDE policy — hamtaPolicy kör egen withTenant,
  // därför utanför transaktionen ovan (samma mönster som hamtaKo).
  const policy = await hamtaPolicy(db, tenantId, payload.module);
  const utfall = evaluateAutonomy(payload, policy, last.kandMotpart);

  // Paketaktiveringen: mallstämplat förslag → mall∩tenant; ostämplat →
  // tenantens bransch (granskningsmotorns fallback).
  const mall = payload.mall_id ? hamtaMall(payload.mall_id) : null;
  const paket = (
    mall ? aktivaBranschpaket(mall, tenantMall) : paketForTenantMall(tenantMall).map((id) => branschpaketRegistret[id])
  ).map((p) => ({ id: p.id, displayName: p.displayName, version: p.version, regler: p.regler }));

  // Historiken flätas på systemtidslinjen (när tenanten senast såg
  // motparten), nyast först, topp 3.
  const historik: (ForhorsHistorikRad & { sortNyckel: string })[] = [
    ...last.verifikat.map((v) => ({
      typ: "verifikation" as const,
      datum: tillIso(v.affarshandelsedatum).slice(0, 10),
      beskrivning: v.beskrivning,
      belopp_ore: Number(v.belopp_ore ?? 0),
      konto: v.konto,
      utfall:
        v.outcome === "auto_approved"
          ? ("policybeslut" as const)
          : v.outcome === "approved"
            ? ("attesterad" as const)
            : ("bokförd" as const),
      verifikationsnummer: v.nummer,
      sortNyckel: tillIso(v.sammanstalld_at),
    })),
    ...last.forslag.map((f) => ({
      typ: "forslag" as const,
      datum: tillIso(f.created_at).slice(0, 10),
      beskrivning: f.summary,
      belopp_ore: f.payload.lines.reduce((s, l) => s + l.debet_ore, 0),
      konto:
        [...f.payload.lines]
          .filter((l) => l.debet_ore > 0)
          .sort((a, b) => b.debet_ore - a.debet_ore)[0]?.konto ?? null,
      utfall: f.status === "rejected" ? ("avvisad" as const) : ("väntar på attest" as const),
      verifikationsnummer: null,
      sortNyckel: tillIso(f.created_at),
    })),
  ]
    .sort((a, b) => b.sortNyckel.localeCompare(a.sortNyckel))
    .slice(0, 3);

  return {
    proposal: {
      id: payload.id,
      summary: payload.summary,
      module: payload.module,
      kind: payload.kind,
      status: last.rad.status,
      confidence: Number(payload.confidence),
      motpart: payload.motpart ?? null,
      affarshandelsedatum: payload.affarshandelsedatum,
      created_at: tillIso(last.rad.created_at),
      flaggor: last.rad.flaggor,
      legal: payload.legal,
      provenance: {
        model: payload.provenance.model,
        mall:
          payload.mall_id && payload.mall_version
            ? `${payload.mall_id}@${payload.mall_version}`
            : null,
        agent_runtime: payload.provenance.agent_runtime ?? null,
        injection_screened: payload.provenance.injection_screened,
      },
    },
    policyutfall: { missade_villkor: utfall.missade, policy },
    paket,
    historik: historik.map(({ sortNyckel: _bort, ...rad }) => rad),
  };
}
