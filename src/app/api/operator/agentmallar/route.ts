import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravOperator } from "@/auth/session";
import { MALL_IDS, mallRegistret } from "@/mallar/registry";

export const runtime = "nodejs";

// GET /api/operator/agentmallar — katalogens METADATA för provisionerings-
// valet. Endast id/namn/version/paket-id:n: systemPrompt och regler är
// mallens hjärna och ska aldrig hamna i en publikt servad klient-bundle
// (registret importeras därför bara på serversidan). Branschpaket-id:n är
// metadata på samma nivå som mall-id:n — reglerna i paketen är det inte.
export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravOperator(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  return NextResponse.json(
    MALL_IDS.map((id) => ({
      id,
      displayName: mallRegistret[id].displayName,
      version: mallRegistret[id].version,
      branschpaket: mallRegistret[id].branschpaket ?? [],
    })),
  );
}
