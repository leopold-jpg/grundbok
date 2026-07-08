import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { skapaRattelse } from "@/lib/ledger";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { tenant_id, verification_id } = (await req.json()) as {
    tenant_id: string;
    verification_id: string;
  };
  try {
    const db = await getDb();
    const r = await skapaRattelse(db, tenant_id, verification_id, "konsult@byran.se");
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json(
      { fel: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
