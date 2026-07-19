import { NextResponse, after } from "next/server";
import { getDb } from "@/lib/db/client";
import { flushLangfuse } from "@/lib/observability/langfuse";
import { kravKonsult, kravTenantIByra } from "@/auth/session";
import { forhorsUnderlag } from "@/ytor/forhor";
import {
  forhorFraga,
  forhorChattAktiv,
  forhorsFragorIdag,
  ForhorsTakError,
  FORHOR_TAK_PER_DAG,
} from "@/modules/forhor";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/byra/forhor?klient=…&proposal=… — förhörschatten lager 1
// (WP40): Varför-panelens deterministiska underlag. Läsande, aldrig
// skrivande — all handling går via attest/avvisa som vanligt. Kräver en
// SPECIFIK klient (aldrig "alla"): underlaget är per förslag och
// byrå-vakten ska pröva exakt den tenanten.
export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravKonsult(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const url = new URL(req.url);
  const klient = url.searchParams.get("klient") ?? "";
  const proposal = url.searchParams.get("proposal") ?? "";
  if (!klient || klient === "alla") {
    return NextResponse.json({ fel: "klient krävs (en specifik klient)" }, { status: 400 });
  }
  if (!UUID_RE.test(proposal)) {
    return NextResponse.json({ fel: "proposal krävs (uuid)" }, { status: 400 });
  }
  if (!(await kravTenantIByra(db, krav.session, klient))) {
    return NextResponse.json({ fel: "klientbolaget tillhör inte din byrå" }, { status: 403 });
  }

  const underlag = await forhorsUnderlag(db, klient, proposal);
  if (!underlag) {
    // RLS gör en annan tenants förslag osynligt — "finns inte" och
    // "fel tenant" är avsiktligt samma svar.
    return NextResponse.json({ fel: "förslaget finns inte hos klienten" }, { status: 404 });
  }

  // WP42: chattläget följer med lager 1-svaret så panelen kan rendera
  // rätt läge direkt — flagga av → endast lager 1, tak nått → vänligt
  // meddelande i stället för frågefältet.
  const chat = {
    enabled: forhorChattAktiv(),
    tak: FORHOR_TAK_PER_DAG,
    anvanda_idag: await forhorsFragorIdag(db, klient),
  };
  return NextResponse.json({ ...underlag, chat });
}

// POST /api/byra/forhor — förhörschatten lager 2 (WP41): konsulten
// förhör agenten om ETT specifikt förslag. Kontexten byggs strikt ur
// tenantens data (RLS); svaret bär källa per påstående och persisteras
// dubbelt: advisory_answer-förslag genom porten + fråga/svar fäst vid
// det förhörda förslaget i audit_log (WP33-mönstret).
export async function POST(req: Request) {
  // Serverless-flush: spans skickas efter att svaret gått iväg — aldrig
  // i requestens kritiska väg. No-op utan LANGFUSE-nycklar.
  after(() => flushLangfuse());
  const db = await getDb();
  const krav = await kravKonsult(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const { tenant_id, proposal_id, fraga } = (await req.json().catch(() => ({}))) as {
    tenant_id?: string;
    proposal_id?: string;
    fraga?: string;
  };
  if (!tenant_id || !fraga?.trim()) {
    return NextResponse.json({ fel: "tenant_id och fraga krävs" }, { status: 400 });
  }
  if (!proposal_id || !UUID_RE.test(proposal_id)) {
    return NextResponse.json({ fel: "proposal_id krävs (uuid)" }, { status: 400 });
  }
  if (!(await kravTenantIByra(db, krav.session, tenant_id))) {
    return NextResponse.json({ fel: "klientbolaget tillhör inte din byrå" }, { status: 403 });
  }
  // WP42: flaggan av → endast lager 1. Vänligt nej, aldrig en död yta.
  if (!forhorChattAktiv()) {
    return NextResponse.json(
      { fel: "Förhörschatten är avstängd — Varför-panelens underlag gäller som vanligt." },
      { status: 403 },
    );
  }

  try {
    const svar = await forhorFraga(db, {
      tenantId: tenant_id,
      proposalId: proposal_id,
      fraga: fraga.trim(),
      stalldAv: krav.session.user.id,
    });
    if (!svar) {
      return NextResponse.json({ fel: "förslaget finns inte hos klienten" }, { status: 404 });
    }
    return NextResponse.json(svar);
  } catch (err) {
    // Kostnadsvakten (WP42): 429 med det vänliga meddelandet.
    if (err instanceof ForhorsTakError) {
      return NextResponse.json({ fel: err.message }, { status: 429 });
    }
    return NextResponse.json(
      { fel: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
