import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravKlient } from "@/auth/session";
import { listaUnderlag } from "@/lib/intake";

export const runtime = "nodejs";

// Läget (WP22): kundappens hemyta — ENDAST obestridliga siffror i v1:
// inlämnat denna månad, antal som väntar, senast bokfört. Resultat och
// saldon är en per-klient-flagga byrån slår på senare (default av) —
// den vägen byggs inte här.
export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravKlient(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const rader = await listaUnderlag(db, krav.tenantId);
  const nu = new Date();
  const manadsStart = new Date(nu.getFullYear(), nu.getMonth(), 1).getTime();

  const inlamnatManad = rader.filter((r) => new Date(r.skapad).getTime() >= manadsStart).length;
  const vantar = rader.filter((r) => r.status !== "bokfort").length;
  const senastBokfort = rader
    .filter((r) => r.status === "bokfort" && r.bokfort_at)
    .sort((a, b) => (b.bokfort_at ?? "").localeCompare(a.bokfort_at ?? ""))[0];

  return NextResponse.json({
    inlamnat_manad: inlamnatManad,
    vantar,
    senast_bokfort: senastBokfort
      ? {
          summary: senastBokfort.summary,
          motpart: senastBokfort.motpart,
          bokfort_at: senastBokfort.bokfort_at,
          verifikationsnummer: senastBokfort.verifikationsnummer,
        }
      : null,
  });
}
