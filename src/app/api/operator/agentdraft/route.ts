import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravOperator } from "@/auth/session";
import { foreslaAgentDraft } from "@/mallar/agentdraft";

export const runtime = "nodejs";

// POST /api/operator/agentdraft — fri beskrivning → förslag på
// (funktionsroll, agentnamn) för provisioneringens steg 2. Regelbaserad
// matchning mot mallregistret på serversidan (ingen LLM): nyckelorden är
// katalogkunskap och ska inte bo i klient-bundlen, av samma skäl som
// registret självt (jfr /api/operator/agentmallar).
export async function POST(req: Request) {
  const db = await getDb();
  const krav = await kravOperator(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const body = (await req.json().catch(() => null)) as { beskrivning?: string } | null;
  if (!body?.beskrivning?.trim()) {
    return NextResponse.json({ fel: "beskrivning krävs" }, { status: 400 });
  }

  // null = inget nyckelord träffade: steget förmarkerar aldrig på gissning.
  return NextResponse.json({ forslag: foreslaAgentDraft(body.beskrivning) });
}
