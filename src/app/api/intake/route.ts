import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { intakePort } from "@/lib/intake";

export const runtime = "nodejs";

// POST /api/intake (WP21) — porten för ALLA kanaler in. Tunn adapter
// runt intakePort (samma mönster som /api/proposals): auth via
// klientsession eller tenant-scopad agentnyckel med intake:write,
// tenanten kommer alltid ur principalen.
export async function POST(req: Request) {
  const db = await getDb();
  const svar = await intakePort(db, req);
  return NextResponse.json(svar.body, { status: svar.http });
}
