import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { kravOperator } from "@/auth/session";
import { listaMallar, sparaMall } from "@/ytor/operator";
import { MODULE_IDS, PROPOSAL_KINDS } from "@/contracts";

export const runtime = "nodejs";

// Policymallar (WP14) — operatörens namngivna startpolicys som väljs vid
// provisionering. Samma rimlighetstak som tenant-policyn.

export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravOperator(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  return NextResponse.json(await listaMallar(db));
}

const MallInput = z.object({
  id: z.string().uuid().optional(),
  namn: z.string().min(1).max(100),
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

// POST — skapa (utan id) eller redigera (med id) en mall.
export async function POST(req: Request) {
  const db = await getDb();
  const krav = await kravOperator(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const raw = await req.json().catch(() => null);
  if (!raw) return NextResponse.json({ fel: "ogiltig JSON" }, { status: 400 });

  const parsed = MallInput.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { fel: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 422 },
    );
  }

  try {
    const { id } = await sparaMall(db, parsed.data);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json(
      { fel: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
