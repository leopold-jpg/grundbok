import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const tenantId = new URL(req.url).searchParams.get("tenant");
  if (!tenantId) return NextResponse.json({ fel: "tenant krävs" }, { status: 400 });

  const db = await getDb();
  const data = await withTenant(db, tenantId, async (tx) => {
    const vers = await tx.query<{
      id: string;
      nummer: number;
      affarshandelsedatum: string;
      beskrivning: string;
      motpart: string;
      rattar_verifikation: string | null;
      extern_ref: string | null;
      skill_versions: Record<string, string>;
    }>(
      `SELECT id, nummer, affarshandelsedatum, beskrivning, motpart,
              rattar_verifikation, extern_ref, skill_versions
       FROM verifications ORDER BY nummer DESC`,
    );
    const rows = await tx.query<{
      verification_id: string;
      konto: string;
      kontonamn: string;
      debet_ore: number;
      kredit_ore: number;
    }>(
      `SELECT verification_id, konto, kontonamn, debet_ore, kredit_ore
       FROM verification_rows`,
    );
    return vers.rows.map((v) => ({
      ...v,
      rader: rows.rows.filter((r) => r.verification_id === v.id),
    }));
  });

  return NextResponse.json(data);
}
