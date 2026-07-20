import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravKonsult, kravTenantIByra } from "@/auth/session";
import { kundfragorForByra } from "@/ytor/byra";
import { besvaraKundfraga } from "@/modules/kundassistent";

export const runtime = "nodejs";

// Fliken "Frågor" (WP24): kundassistentens eskalerade ärenden i byråns
// kö — med underlaget länkat. Samma byrå-vakt som kö/logg: tenant-
// tillhörighet verifieras mot sessionen, aldrig mot requesten.

export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravKonsult(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const klient = new URL(req.url).searchParams.get("klient") ?? "alla";
  if (klient !== "alla" && !(await kravTenantIByra(db, krav.session, klient))) {
    return NextResponse.json({ fel: "klientbolaget tillhör inte din byrå" }, { status: 403 });
  }

  return NextResponse.json(await kundfragorForByra(db, krav.session, klient));
}

export async function POST(req: Request) {
  const db = await getDb();
  const krav = await kravKonsult(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const body = (await req.json().catch(() => ({}))) as {
    tenant_id?: string;
    fraga_id?: string;
    svar?: string;
  };
  if (!body.tenant_id || !body.fraga_id || !body.svar?.trim()) {
    return NextResponse.json({ fel: "tenant_id, fraga_id och svar krävs" }, { status: 400 });
  }
  if (!(await kravTenantIByra(db, krav.session, body.tenant_id))) {
    return NextResponse.json({ fel: "klientbolaget tillhör inte din byrå" }, { status: 403 });
  }

  try {
    await besvaraKundfraga(db, {
      tenantId: body.tenant_id,
      fragaId: body.fraga_id,
      svar: body.svar,
      besvaradAv: krav.session.user.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { fel: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
