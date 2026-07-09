import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { provisionAgent, listaAgenter } from "@/lib/provisioning";
import { MODULE_IDS, SCOPES } from "@/contracts";

export const runtime = "nodejs";

// Konsultytans agent-API (WP10). OBS: riktig konsult-auth är WP11
// (dokumenterat icke-mål) — tills dess är detta, precis som /admin,
// en obehörighetsskyddad yta endast för lokal körning.

export async function GET(req: Request) {
  const tenantId = new URL(req.url).searchParams.get("tenant");
  if (!tenantId) return NextResponse.json({ fel: "tenant krävs" }, { status: 400 });
  const db = await getDb();
  // Listan innehåller aldrig nyckel eller hash (smoke-test 4).
  return NextResponse.json(await listaAgenter(db, tenantId));
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    tenant_id?: string;
    module?: (typeof MODULE_IDS)[number];
    display_name?: string;
    scopes?: (typeof SCOPES)[number][];
    policy?: {
      max_belopp_ore: number;
      min_confidence: number;
      kanda_motparter_endast: boolean;
      tillatna_kinds: string[];
    };
  } | null;

  if (
    !body?.tenant_id ||
    !body.module ||
    !MODULE_IDS.includes(body.module) ||
    !body.display_name?.trim() ||
    (body.scopes && body.scopes.some((s) => !SCOPES.includes(s)))
  ) {
    return NextResponse.json(
      { fel: "tenant_id, giltig module och display_name krävs" },
      { status: 400 },
    );
  }

  const db = await getDb();
  try {
    const ny = await provisionAgent(
      db,
      {
        tenantId: body.tenant_id,
        module: body.module,
        displayName: body.display_name.trim(),
        scopes: body.scopes,
        policy: body.policy as never,
      },
      "konsult:konsult@byran.se", // WP11: verifierad identitet
    );
    // Klartextnyckeln finns bara i detta svar.
    return NextResponse.json(ny, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { fel: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
