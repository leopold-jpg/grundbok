import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { hamtaPolicyer } from "@/lib/admin";
import { sparaPolicy } from "@/lib/decisions";
import { MODULE_IDS, PROPOSAL_KINDS } from "@/contracts";
import { kravKonsult, kravTenantIByra } from "@/auth/session";

export const runtime = "nodejs";

// Klientens autonomipolicy i byråns arbetsyta (WP13). Attest-språket i
// UI:t ("bokför själv upp till X kr för kända motparter") mappar rakt på
// kärnans policyfält — kärnan rörs inte. Correction-undantaget är en hård
// regel i evaluateAutonomy oavsett vad som sparas här.

export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravKonsult(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const klient = new URL(req.url).searchParams.get("klient");
  if (!klient) return NextResponse.json({ fel: "klient krävs" }, { status: 400 });
  if (!(await kravTenantIByra(db, krav.session, klient))) {
    return NextResponse.json({ fel: "klientbolaget tillhör inte din byrå" }, { status: 403 });
  }

  return NextResponse.json(await hamtaPolicyer(db, klient));
}

// Samma rimlighetsvalidering som v0-admin: ören som icke-negativa heltal
// med tak (en felskriven policy ska inte öppna obegränsad autonomi).
const PolicyInput = z.object({
  tenant_id: z.string().min(1),
  module: z.enum(MODULE_IDS),
  max_belopp_ore: z
    .number()
    .int()
    .nonnegative()
    .max(100_000_000_000, "max_belopp_ore över rimlighetstaket (1 mdkr)"),
  min_confidence: z.number().min(0).max(1),
  kanda_motparter_endast: z.boolean(),
  tillatna_kinds: z.array(z.enum(PROPOSAL_KINDS)),
});

export async function POST(req: Request) {
  const db = await getDb();
  const krav = await kravKonsult(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const raw = await req.json().catch(() => null);
  if (!raw) return NextResponse.json({ fel: "ogiltig JSON" }, { status: 400 });

  const parsed = PolicyInput.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { fel: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 422 },
    );
  }
  if (!(await kravTenantIByra(db, krav.session, parsed.data.tenant_id))) {
    return NextResponse.json({ fel: "klientbolaget tillhör inte din byrå" }, { status: 403 });
  }

  try {
    await sparaPolicy(db, parsed.data);
    return NextResponse.json({ ok: true, policy: parsed.data });
  } catch (err) {
    return NextResponse.json(
      { fel: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
