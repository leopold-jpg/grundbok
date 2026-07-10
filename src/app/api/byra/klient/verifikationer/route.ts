import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant";
import { kravKonsult, kravTenantIByra } from "@/auth/session";

export const runtime = "nodejs";

// GET /api/byra/klient/verifikationer?klient=… — klientens huvudbok
// (WP13). RLS scopar läsningen; byrå-vakten stoppar URL-manipulation.
export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravKonsult(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const klient = new URL(req.url).searchParams.get("klient");
  if (!klient) return NextResponse.json({ fel: "klient krävs" }, { status: 400 });
  if (!(await kravTenantIByra(db, krav.session, klient))) {
    return NextResponse.json({ fel: "klientbolaget tillhör inte din byrå" }, { status: 403 });
  }

  const data = await withTenant(db, klient, async (tx) => {
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
