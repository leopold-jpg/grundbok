import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { sessionFranRequest } from "@/auth/session";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const db = await getDb();
  const session = await sessionFranRequest(db, req);
  if (!session) return NextResponse.json({ fel: "ingen session" }, { status: 401 });
  return NextResponse.json({
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    operator: session.user.is_operator,
    byra: session.byra,
  });
}
