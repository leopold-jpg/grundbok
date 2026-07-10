import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravOperator } from "@/auth/session";
import { roteraNyckel } from "@/ytor/operator";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// POST /api/agents/[id]/rotera — nyckelrotation som ETT flöde (WP14):
// ny agent med samma konfiguration + gamla avslutas i samma anrop.
// Klartextnyckeln finns bara i detta svar.
export async function POST(req: Request, { params }: Params) {
  const db = await getDb();
  const krav = await kravOperator(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const { id } = await params;
  const { tenant_id } = (await req.json().catch(() => ({}))) as { tenant_id?: string };
  if (!tenant_id) return NextResponse.json({ fel: "tenant_id krävs" }, { status: 400 });

  try {
    const ny = await roteraNyckel(db, tenant_id, id, `operator:${krav.session.user.id}`);
    return NextResponse.json(ny, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { fel: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
