import { NextResponse, after } from "next/server";
import { propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import { getDb } from "@/lib/db/client";
import { flushLangfuse } from "@/lib/observability/langfuse";
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
  // Serverless-flush: spans skickas efter att svaret gått iväg — aldrig
  // i requestens kritiska väg. No-op utan LANGFUSE-nycklar.
  after(() => flushLangfuse());
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

  // Trace-rot för manuellt intag: tenant_id + agent_id på varje trace
  // (kravet). Intag saknar agent-rad — konsultens manuella kanal är
  // identiteten. tolka() nästlar sin span + ev. generation här under.
  const resultat = await propagateAttributes(
    {
      traceName: "intag-tolkning",
      userId: tenant_id,
      metadata: { tenant_id, agent_id: "konsult:manuell-intag", document_id: documentId },
      tags: ["intag"],
    },
    () =>
      startActiveObservation("intag-tolkning", async (span) => {
        const r = await tolka(text);
        span.update({
          input: { document_id: documentId, underlag_langd: text.length },
          output: { motor: r.motor, antal_fynd: injektionsfynd.length },
        });
        return r;
      }),
  );

  return NextResponse.json({ document_id: documentId, ...resultat, injektionsfynd });
}
