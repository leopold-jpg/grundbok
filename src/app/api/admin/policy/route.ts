import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { hamtaPolicyer } from "@/lib/admin";
import { sparaPolicy } from "@/lib/decisions";
import { MODULE_IDS, PROPOSAL_KINDS } from "@/contracts";

export const runtime = "nodejs";

// GET /api/admin/policy?tenant=… — tenantens autonomipolicyer.
export async function GET(req: Request) {
  const tenantId = new URL(req.url).searchParams.get("tenant");
  if (!tenantId) return NextResponse.json({ fel: "tenant krävs" }, { status: 400 });

  const db = await getDb();
  return NextResponse.json(await hamtaPolicyer(db, tenantId));
}

// Rimlighetsvalidering: ören som icke-negativa heltal (tak 1 mdkr — en
// felskriven policy ska inte kunna öppna obegränsad autonomi), konfidens
// 0–1, kinds ur kontraktets lista. Correction-undantaget behöver inte
// valideras här — det är en hård regel i evaluateAutonomy oavsett policy.
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

// POST /api/admin/policy — spara (upsert) en moduls autonomipolicy.
export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  if (!raw) return NextResponse.json({ fel: "ogiltig JSON" }, { status: 400 });

  const parsed = PolicyInput.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { fel: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 422 },
    );
  }

  try {
    const db = await getDb();
    await sparaPolicy(db, parsed.data);
    return NextResponse.json({ ok: true, policy: parsed.data });
  } catch (err) {
    return NextResponse.json(
      { fel: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
