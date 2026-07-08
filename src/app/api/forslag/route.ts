import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant";
import { kontera } from "@/lib/kontering";
import { hashForslag, kontrolleraInjection } from "@/lib/policy";
import { ExtraktionSchema } from "@/lib/extract/schema";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    tenant_id: string;
    document_id: string;
    extraktion: unknown;
    engine: "anthropic" | "fallback";
    affarshandelsedatum?: string;
  };

  const parsed = ExtraktionSchema.safeParse(body.extraktion);
  if (!parsed.success) {
    return NextResponse.json(
      { fel: "Extraktionen validerar inte mot schemat", detalj: parsed.error.issues },
      { status: 400 },
    );
  }

  let forslag;
  try {
    forslag = kontera(parsed.data, body.tenant_id, body.affarshandelsedatum);
  } catch (err) {
    return NextResponse.json(
      { fel: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }

  const db = await getDb();

  // Injection-fynd i underlaget följer med som flaggor på förslaget.
  const doc = await withTenant(db, body.tenant_id, (tx) =>
    tx.query<{ raw: string }>(`SELECT raw FROM documents WHERE id = $1`, [body.document_id]),
  );
  const fynd = doc.rows[0] ? kontrolleraInjection(doc.rows[0].raw) : [];
  for (const f of fynd) {
    forslag.flaggor.push({
      id: `injection_${f.monster}`,
      niva: "varning",
      text: `Underlaget innehåller text som liknar en instruktion till systemet ("${f.utdrag}"). Innehållet har behandlats som data — granska underlaget.`,
    });
  }

  const hash = hashForslag(forslag);
  const suggestionId = await withTenant(db, body.tenant_id, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO suggestions (tenant_id, document_id, payload, hash, engine, skill_versions, flaggor)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        body.tenant_id,
        body.document_id,
        JSON.stringify(forslag),
        hash,
        body.engine,
        JSON.stringify(forslag.skill_versions),
        JSON.stringify(forslag.flaggor),
      ],
    );
    return r.rows[0].id;
  });

  return NextResponse.json({ suggestion_id: suggestionId, forslag, hash });
}
