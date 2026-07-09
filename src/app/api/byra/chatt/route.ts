import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { svaraPaFraga } from "@/modules/radgivning";
import { kravKonsult, kravTenantIByra } from "@/auth/session";

export const runtime = "nodejs";

// POST /api/byra/chatt — rådgivningsmodulen som chatt (WP13). Saldofrågor
// går via ledger:read scopat till vald klient; svaret bär lagrum och
// konfidens. Historiken bor hos klienten (sessionStorage per konsult).
export async function POST(req: Request) {
  const db = await getDb();
  const krav = await kravKonsult(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const { tenant_id, fraga } = (await req.json().catch(() => ({}))) as {
    tenant_id?: string;
    fraga?: string;
  };
  if (!tenant_id || !fraga?.trim()) {
    return NextResponse.json({ fel: "tenant_id och fraga krävs" }, { status: 400 });
  }
  if (!(await kravTenantIByra(db, krav.session, tenant_id))) {
    return NextResponse.json({ fel: "klientbolaget tillhör inte din byrå" }, { status: 403 });
  }

  try {
    return NextResponse.json(await svaraPaFraga(db, tenant_id, fraga));
  } catch (err) {
    return NextResponse.json(
      { fel: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
