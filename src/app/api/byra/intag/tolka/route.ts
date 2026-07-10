import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant";
import { tolka } from "@/lib/extract";
import { kontrolleraInjection } from "@/lib/policy";
import { kravKonsult, kravTenantIByra } from "@/auth/session";

export const runtime = "nodejs";

// POST /api/byra/intag/tolka — manuellt intag (WP13). Samma tolkning som
// demoflödet, men bakom konsult-session och byrå-vakt. TODO S3: mejl-intag
// och kundapps-foto blir ytterligare källor in i SAMMA flöde — en kanal
// är bara en källa.
export async function POST(req: Request) {
  const db = await getDb();
  const krav = await kravKonsult(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const { tenant_id, text } = (await req.json().catch(() => ({}))) as {
    tenant_id?: string;
    text?: string;
  };
  if (!tenant_id || !text?.trim()) {
    return NextResponse.json({ fel: "tenant_id och text krävs" }, { status: 400 });
  }
  if (!(await kravTenantIByra(db, krav.session, tenant_id))) {
    return NextResponse.json({ fel: "klientbolaget tillhör inte din byrå" }, { status: 403 });
  }

  // Underlaget är untrusted input — screenas FÖRE LLM-anropet.
  const injektionsfynd = kontrolleraInjection(text);

  const documentId = await withTenant(db, tenant_id, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO documents (tenant_id, raw) VALUES ($1, $2) RETURNING id`,
      [tenant_id, text],
    );
    return r.rows[0].id;
  });

  const resultat = await tolka(text);

  return NextResponse.json({ document_id: documentId, ...resultat, injektionsfynd });
}
