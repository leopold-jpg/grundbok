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

  const body = (await req.json().catch(() => null)) as { beskrivning?: unknown } | null;
  const beskrivning = body?.beskrivning;
  // Typvakt före .trim() (granskningsfynd): {"beskrivning": 123} ska ge
  // 400, inte en TypeError-500. Taket matchar syskonrouternas hållning
  // (jfr mallar-routens namn-tak) — fältet är en enradig beskrivning,
  // aldrig ett dokument.
  if (typeof beskrivning !== "string" || !beskrivning.trim()) {
    return NextResponse.json({ fel: "beskrivning krävs" }, { status: 400 });
  }
  if (beskrivning.length > 500) {
    return NextResponse.json({ fel: "beskrivning: max 500 tecken" }, { status: 400 });
  }

  // null = inget nyckelord träffade: steget förmarkerar aldrig på gissning.
  return NextResponse.json({ forslag: foreslaAgentDraft(beskrivning) });
}
