import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravKlient } from "@/auth/session";

export const runtime = "nodejs";

// Kundappens sessionsvy (WP20/WP22): vem är inloggad och vilket bolag.
// Tenanten kommer ur sessionen — appen kan inte fråga om något annat.
export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravKlient(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  // Resultatflaggan (WP22): per-klient-flagga byrån slår på senare —
  // v1 visar ENDAST obestridliga siffror; flaggan byggs men är default av.
  const r = await db.query<{ visa_resultat: boolean }>(
    `SELECT visa_resultat FROM tenants WHERE id = $1`,
    [krav.tenantId],
  );

  return NextResponse.json({
    anvandare_id: krav.session.user.id,
    namn: krav.session.user.name,
    bolag: krav.session.klient!.tenant_namn,
    visa_resultat: Boolean(r.rows[0]?.visa_resultat),
  });
}
