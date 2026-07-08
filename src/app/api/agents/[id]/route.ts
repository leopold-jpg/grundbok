import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { avslutaAgent, pausaAgent, ateruppta } from "@/lib/provisioning";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// DELETE = avsluta (status canceled + revoked_at) — aldrig hård delete:
// beslutshistoriken refererar agenten.
export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params;
  const { tenant_id } = (await req.json().catch(() => ({}))) as { tenant_id?: string };
  if (!tenant_id) return NextResponse.json({ fel: "tenant_id krävs" }, { status: 400 });
  const db = await getDb();
  await avslutaAgent(db, tenant_id, id);
  return NextResponse.json({ status: "canceled" });
}

// PATCH { status: 'paused' | 'active' } — pausa/återuppta.
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    tenant_id?: string;
    status?: "paused" | "active";
  };
  if (!body.tenant_id || !body.status || !["paused", "active"].includes(body.status)) {
    return NextResponse.json(
      { fel: "tenant_id och status (paused|active) krävs" },
      { status: 400 },
    );
  }
  const db = await getDb();
  if (body.status === "paused") await pausaAgent(db, body.tenant_id, id);
  else await ateruppta(db, body.tenant_id, id);
  return NextResponse.json({ status: body.status });
}
