import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { hamtaBeslutslogg } from "@/lib/admin";

export const runtime = "nodejs";

// GET /api/admin/logg?tenant=…&limit=… — beslutsloggen, nyast först.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const tenantId = params.get("tenant");
  if (!tenantId) return NextResponse.json({ fel: "tenant krävs" }, { status: 400 });

  const raw = Number(params.get("limit") ?? 50);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 500) : 50;

  const db = await getDb();
  return NextResponse.json(await hamtaBeslutslogg(db, tenantId, limit));
}
