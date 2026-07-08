import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { fattaBeslut } from "@/lib/ledger";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { tenant_id, suggestion_id, beslut, godkand_av } = (await req.json()) as {
    tenant_id: string;
    suggestion_id: string;
    beslut: "godkand" | "avvisad";
    godkand_av: string;
  };

  try {
    const db = await getDb();
    const resultat = await fattaBeslut(
      db,
      tenant_id,
      suggestion_id,
      beslut,
      godkand_av || "konsult@byran.se",
    );
    return NextResponse.json(resultat);
  } catch (err) {
    return NextResponse.json(
      { fel: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
