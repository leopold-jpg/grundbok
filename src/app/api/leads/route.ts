import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { sparaLead, valideraLead, type NyLead } from "@/ytor/leads";

export const runtime = "nodejs";

// Publik endpoint (WP12) — den enda oautentiserade skrivvägen, och den
// rör aldrig räkenskapsinformation: ett lead är en kontaktförfrågan.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const fel = valideraLead(body);
  if (fel) return NextResponse.json({ fel }, { status: 400 });

  const db = await getDb();
  const { id } = await sparaLead(db, body as NyLead);
  // id:t gör väntelistans kvittens verklig — ett registrerings-nr
  // besökaren kan referera till, inget påhittat löpnummer.
  return NextResponse.json({ mottagen: true, id });
}
