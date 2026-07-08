import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { svaraPaFraga } from "@/modules/radgivning";

export const runtime = "nodejs";

// POST /api/radgivning — rådgivningsmodulens fråga-yta.
// Modulen är läsande: svaret blir ett advisory_answer-förslag som går
// genom beslutsmotorn (handleProposal) med modulens egen principal —
// aldrig någon direkt väg till huvudboken (ADR-0002).
export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  if (!raw) return NextResponse.json({ fel: "ogiltig JSON" }, { status: 400 });

  const { tenant_id, fraga } = raw as { tenant_id?: unknown; fraga?: unknown };
  if (typeof tenant_id !== "string" || !tenant_id || typeof fraga !== "string" || !fraga.trim()) {
    return NextResponse.json({ fel: "tenant_id och fraga krävs" }, { status: 400 });
  }

  const db = await getDb();
  const resultat = await svaraPaFraga(db, tenant_id, fraga);
  return NextResponse.json(resultat);
}
