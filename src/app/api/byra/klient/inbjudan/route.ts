import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravKonsult, kravTenantIByra } from "@/auth/session";
import { skapaKlientInbjudan, listaKlientAnvandare } from "@/auth/klient-inbjudan";

export const runtime = "nodejs";

// Klientinbjudan (WP20/WP24): konsulten bjuder in klientbolagets
// användare från klientvyn. Samma byrå-vakt som allt annat i /byra —
// tenant-tillhörighet verifieras mot sessionen, aldrig mot requesten.

export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravKonsult(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const klient = new URL(req.url).searchParams.get("klient");
  if (!klient) return NextResponse.json({ fel: "klient krävs" }, { status: 400 });
  if (!(await kravTenantIByra(db, krav.session, klient))) {
    return NextResponse.json({ fel: "klientbolaget tillhör inte din byrå" }, { status: 403 });
  }

  return NextResponse.json(await listaKlientAnvandare(db, klient));
}

export async function POST(req: Request) {
  const db = await getDb();
  const krav = await kravKonsult(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const body = (await req.json().catch(() => ({}))) as {
    tenant_id?: string;
    email?: string;
  };
  if (!body.tenant_id || !body.email?.trim()) {
    return NextResponse.json({ fel: "tenant_id och email krävs" }, { status: 400 });
  }
  if (!(await kravTenantIByra(db, krav.session, body.tenant_id))) {
    return NextResponse.json({ fel: "klientbolaget tillhör inte din byrå" }, { status: 403 });
  }

  try {
    const inbjudan = await skapaKlientInbjudan(db, {
      tenantId: body.tenant_id,
      email: body.email,
      skapadAv: krav.session.user.id,
    });
    // Klartexttoken finns bara i detta svar — konsulten kopierar länken
    // och skickar den till kunden (mejladaptern är intagets kanal in,
    // inte inbjudans).
    return NextResponse.json(
      { id: inbjudan.id, lank: `/app/inbjudan?token=${inbjudan.token}`, utgar: inbjudan.utgar },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { fel: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
