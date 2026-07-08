import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import {
  skapaAgentNyckel,
  listaAgentNycklar,
  revokeraAgentNyckel,
} from "@/lib/agent-auth";
import { MODULE_IDS, SCOPES } from "@/contracts";

export const runtime = "nodejs";

// Adminkonsolens nyckelhantering: skapa (klartexten returneras EN gång),
// lista och revokera (raden inaktiveras — historiken består). Designat
// för OpenClaw-agenter hos kund: en nyckel per agent, rotation = skapa
// ny + revokera gammal.

export async function GET(req: Request) {
  const tenantId = new URL(req.url).searchParams.get("tenant");
  if (!tenantId) return NextResponse.json({ fel: "tenant krävs" }, { status: 400 });
  const db = await getDb();
  return NextResponse.json(await listaAgentNycklar(db, tenantId));
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    tenant_id: string;
    module: (typeof MODULE_IDS)[number];
    scopes: (typeof SCOPES)[number][];
    namn: string;
  };
  if (
    !body.tenant_id ||
    !MODULE_IDS.includes(body.module) ||
    !Array.isArray(body.scopes) ||
    body.scopes.some((s) => !SCOPES.includes(s)) ||
    !body.namn?.trim()
  ) {
    return NextResponse.json(
      { fel: "tenant_id, giltig module, scopes[] och namn krävs" },
      { status: 400 },
    );
  }
  const db = await getDb();
  const ny = await skapaAgentNyckel(db, {
    tenantId: body.tenant_id,
    module: body.module,
    scopes: body.scopes,
    namn: body.namn.trim(),
  });
  // Klartextnyckeln finns bara i detta svar — endast hashen är lagrad.
  return NextResponse.json(ny, { status: 201 });
}

export async function PATCH(req: Request) {
  const { tenant_id, key_id } = (await req.json()) as {
    tenant_id: string;
    key_id: string;
  };
  if (!tenant_id || !key_id) {
    return NextResponse.json({ fel: "tenant_id och key_id krävs" }, { status: 400 });
  }
  const db = await getDb();
  await revokeraAgentNyckel(db, tenant_id, key_id);
  return NextResponse.json({ status: "revokerad" });
}
