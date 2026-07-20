import { NextResponse, after } from "next/server";
import { getDb } from "@/lib/db/client";
import { flushLangfuse } from "@/lib/observability/langfuse";
import { kravKlient } from "@/auth/session";
import {
  svaraPaKundfraga,
  eskaleraKundfraga,
  listaKundfragor,
} from "@/modules/kundassistent";

export const runtime = "nodejs";

// Kundassistenten (WP22): chatt scopad till egna underlag och verifikat
// — ALDRIG rådgivning; fallback är eskalering till byrån. GET listar
// eskalerade frågor (öppna + besvarade) för appens "Frågor hos byrån".

export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravKlient(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  return NextResponse.json(await listaKundfragor(db, krav.tenantId));
}

export async function POST(req: Request) {
  after(() => flushLangfuse());
  const db = await getDb();
  const krav = await kravKlient(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const body = (await req.json().catch(() => ({}))) as {
    fraga?: string;
    eskalera?: boolean;
    underlag_id?: string;
  };
  if (!body.fraga?.trim()) {
    return NextResponse.json({ fel: "fraga krävs" }, { status: 400 });
  }

  try {
    if (body.eskalera) {
      const arende = await eskaleraKundfraga(db, {
        tenantId: krav.tenantId,
        fraga: body.fraga,
        underlagId: body.underlag_id ?? null,
        stalldAv: `klient:${krav.session.user.id}`,
      });
      return NextResponse.json(
        {
          eskalerad: true,
          kundfraga_id: arende.id,
          svar: "Frågan är skickad till din revisor — svaret dyker upp här när byrån svarat.",
        },
        { status: 201 },
      );
    }

    const svar = await svaraPaKundfraga(db, {
      tenantId: krav.tenantId,
      fraga: body.fraga,
      stalldAv: `klient:${krav.session.user.id}`,
    });
    return NextResponse.json(svar);
  } catch (err) {
    return NextResponse.json(
      { fel: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
