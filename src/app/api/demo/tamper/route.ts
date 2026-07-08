import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant";

export const runtime = "nodejs";

// Demo-beat 6: försök ändra en bokförd verifikation FRÅN APPLIKATIONSKODEN.
// Databasen vägrar — isoleringen och oföränderligheten är inte if-satser
// i UI:t utan rättigheter, RLS-policyer och triggers i Postgres.
export async function POST(req: Request) {
  const { tenant_id } = (await req.json()) as { tenant_id: string };
  const db = await getDb();

  try {
    await withTenant(db, tenant_id, (tx) =>
      tx.query(
        `UPDATE verifications SET beskrivning = 'MANIPULERAD' WHERE nummer = (
           SELECT max(nummer) FROM verifications
         )`,
      ),
    );
    return NextResponse.json({
      resultat: "UPPDATERINGEN GICK IGENOM — detta ska aldrig hända",
    });
  } catch (err) {
    return NextResponse.json({
      resultat: "blockerad",
      dbfel: err instanceof Error ? err.message : String(err),
    });
  }
}
