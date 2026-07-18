import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { listaAgenter, provisionAgent } from "@/lib/provisioning";
import { provisioneraMedMall } from "@/ytor/operator";
import { MODULE_IDS, SCOPES } from "@/contracts";
import { MALL_IDS, type MallId } from "@/mallar/registry";
import { kravOperator } from "@/auth/session";

export const runtime = "nodejs";

// Agent-API:t är operatörens (WP14): provisionering och drift bor hos
// operatören — byrån har en läsvy via /api/byra/klient/agenter. Nyckel-
// autentiserade agenter berörs inte (de går via /api/proposals).

export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravOperator(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const tenantId = new URL(req.url).searchParams.get("tenant");
  if (!tenantId) return NextResponse.json({ fel: "tenant krävs" }, { status: 400 });
  // Listan innehåller aldrig nyckel eller hash.
  return NextResponse.json(await listaAgenter(db, tenantId));
}

export async function POST(req: Request) {
  const db = await getDb();
  const krav = await kravOperator(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const body = (await req.json().catch(() => null)) as {
    tenant_id?: string;
    module?: (typeof MODULE_IDS)[number];
    /** Vald policymall — mallens värden kopieras till tenantens policy. */
    mall_id?: string;
    /** Agentmall ur mallregistret (WP11, ADR-0004): sätter modul,
     *  mallpekare och förvald policy — den versionerade vägen. */
    agentmall?: MallId;
    display_name?: string;
    scopes?: (typeof SCOPES)[number][];
  } | null;

  if (
    !body?.tenant_id ||
    !body.display_name?.trim() ||
    (!body.module && !body.mall_id && !body.agentmall) ||
    (body.module && !MODULE_IDS.includes(body.module)) ||
    (body.agentmall && !MALL_IDS.includes(body.agentmall)) ||
    (body.scopes && body.scopes.some((s) => !SCOPES.includes(s)))
  ) {
    return NextResponse.json(
      { fel: "tenant_id, display_name och module, mall_id eller agentmall krävs" },
      { status: 400 },
    );
  }

  try {
    const ny = body.agentmall
      ? await provisionAgent(
          db,
          {
            tenantId: body.tenant_id,
            mall: body.agentmall,
            displayName: body.display_name.trim(),
            scopes: body.scopes,
          },
          `operator:${krav.session.user.id}`,
        )
      : await provisioneraMedMall(
          db,
          {
            tenantId: body.tenant_id,
            displayName: body.display_name.trim(),
            mallId: body.mall_id,
            module: body.module,
            scopes: body.scopes,
          },
          `operator:${krav.session.user.id}`,
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
