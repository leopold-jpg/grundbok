import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";

export const runtime = "nodejs";

export async function GET() {
  const db = await getDb();
  const r = await db.query<{ id: string; namn: string; mall: string }>(
    `SELECT id, namn, mall FROM tenants ORDER BY id`,
  );
  return NextResponse.json(r.rows);
}
