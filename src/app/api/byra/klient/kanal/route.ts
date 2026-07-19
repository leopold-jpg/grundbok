import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravKonsult, kravTenantIByra } from "@/auth/session";
import { listaKlientAnvandare } from "@/auth/klient-inbjudan";
import { listaAvsandare } from "@/lib/mejl/avsandare";
import { inboundAdress, listaKarantan } from "@/lib/mejl/inbound";

export const runtime = "nodejs";

// Klientvyens kanalöversikt (WP24): klientanvändare + inbjudningar
// (app aktiverad?), mejladressen in, registrerade avsändare och
// karantänen. Läsvy — klienten hanterar sina avsändare i appen;
// inbjudningar skapas via /api/byra/klient/inbjudan.
export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravKonsult(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const klient = new URL(req.url).searchParams.get("klient");
  if (!klient) return NextResponse.json({ fel: "klient krävs" }, { status: 400 });
  if (!(await kravTenantIByra(db, krav.session, klient))) {
    return NextResponse.json({ fel: "klientbolaget tillhör inte din byrå" }, { status: 403 });
  }

  const [konton, avsandare, karantan] = await Promise.all([
    listaKlientAnvandare(db, klient),
    listaAvsandare(db, klient),
    listaKarantan(db, klient),
  ]);

  return NextResponse.json({
    app_aktiverad: konton.anvandare.length > 0,
    anvandare: konton.anvandare,
    inbjudningar: konton.inbjudningar,
    mejladress: inboundAdress(klient),
    avsandare,
    karantan,
  });
}
