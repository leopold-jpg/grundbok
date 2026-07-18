import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravOperator } from "@/auth/session";
import {
  BRANSCHPAKET_IDS,
  MALL_IDS,
  aktivaBranschpaket,
  branschpaketRegistret,
  mallRegistret,
  tenantmallTillPaket,
} from "@/mallar/registry";

export const runtime = "nodejs";

// GET /api/operator/agentmallar — katalogens METADATA för provisionerings-
// flödet (WP27). Endast id/namn/version/paket-id:n: systemPrompt och
// regler är mallens hjärna och ska aldrig hamna i en publikt servad
// klient-bundle (registret importeras därför bara på serversidan).
// Aktiveringskartan (tenantmall → paket) skickas med så steg 2 kan VISA
// vilka paket klientens bransch aktiverar — branschen väljs aldrig
// manuellt, den härleds ur tenant-kontexten (ADR-0005).
export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravOperator(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  return NextResponse.json({
    mallar: MALL_IDS.map((id) => ({
      id,
      displayName: mallRegistret[id].displayName,
      version: mallRegistret[id].version,
      branschpaket: mallRegistret[id].branschpaket ?? [],
      // Serverderiverat (granskningsfynd WP29): vilka paket som är aktiva
      // per branschmall räknas av SAMMA aktivaBranschpaket som driften —
      // klienten visar, den härleder aldrig själv.
      aktiva_per_tenantmall: Object.fromEntries(
        Object.keys(tenantmallTillPaket()).map((tm) => [
          tm,
          aktivaBranschpaket(mallRegistret[id], tm).map((p) => p.id),
        ]),
      ),
    })),
    paket: Object.fromEntries(
      BRANSCHPAKET_IDS.map((id) => [
        id,
        {
          displayName: branschpaketRegistret[id].displayName,
          version: branschpaketRegistret[id].version,
        },
      ]),
    ),
    tenantmall_till_paket: tenantmallTillPaket(),
  });
}
