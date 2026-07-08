import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant";
import { tolka } from "@/lib/extract";
import { kontrolleraInjection } from "@/lib/policy";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { tenant_id, text } = (await req.json()) as {
    tenant_id: string;
    text: string;
  };
  if (!tenant_id || !text?.trim()) {
    return NextResponse.json({ fel: "tenant_id och text krävs" }, { status: 400 });
  }

  // Injection-kontroll FÖRE LLM-anropet — dokumentet är untrusted input.
  const injektionsfynd = kontrolleraInjection(text);

  const db = await getDb();
  const documentId = await withTenant(db, tenant_id, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO documents (tenant_id, raw) VALUES ($1, $2) RETURNING id`,
      [tenant_id, text],
    );
    return r.rows[0].id;
  });

  const resultat = await tolka(text);

  return NextResponse.json({
    document_id: documentId,
    ...resultat,
    injektionsfynd,
  });
}
