import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravKonsult, kravTenantIByra } from "@/auth/session";
import { forhorsUnderlag } from "@/ytor/forhor";

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
  return NextResponse.json(underlag);
}
