import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravKonsult, kravTenantIByra } from "@/auth/session";
import { kompletteringarForByra } from "@/ytor/byra";
import {
  skapaFraga,
  markeraPamind,
  paminnMedMejl,
  registreraSvar,
} from "@/lib/kompletteringar";

export const runtime = "nodejs";

// Underlagsjakten (WP33). GET ?klient=…|alla listar kompletteringskön
// per klient (med månadsgrönt v0 + påminnelseutkast); POST utför en av
// handlingarna fraga/paminn/svar. Samma byrå-vakt som kö och logg —
// tenant-tillhörighet verifieras mot sessionen, aldrig mot requesten.

export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravKonsult(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const klient = new URL(req.url).searchParams.get("klient") ?? "alla";
  if (klient !== "alla" && !(await kravTenantIByra(db, krav.session, klient))) {
    return NextResponse.json({ fel: "klientbolaget tillhör inte din byrå" }, { status: 403 });
  }

  return NextResponse.json(await kompletteringarForByra(db, krav.session, klient));
}

type PostBody = {
  handling?: "fraga" | "paminn" | "svar";
  tenant_id?: string;
  proposal_id?: string;
  komplettering_id?: string;
  fraga?: string;
  svar?: string;
};

export async function POST(req: Request) {
  const db = await getDb();
  const krav = await kravKonsult(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const body = (await req.json().catch(() => ({}))) as PostBody;
  if (!body.tenant_id) {
    return NextResponse.json({ fel: "tenant_id krävs" }, { status: 400 });
  }
  if (!(await kravTenantIByra(db, krav.session, body.tenant_id))) {
    return NextResponse.json({ fel: "klientbolaget tillhör inte din byrå" }, { status: 403 });
  }

  const konsult = krav.session.user.id;
  try {
    switch (body.handling) {
      case "fraga": {
        if (!body.proposal_id || !body.fraga?.trim()) {
          return NextResponse.json({ fel: "proposal_id och fraga krävs" }, { status: 400 });
        }
        const r = await skapaFraga(db, {
          tenantId: body.tenant_id,
          proposalId: body.proposal_id,
          fraga: body.fraga,
          stalldAv: konsult,
        });
        return NextResponse.json({ ok: true, komplettering_id: r.id });
      }
      case "paminn": {
        // Utan komplettering_id: Påminn-knappen (WP23) — det färdiga
        // utkastet MEJLAS via adaptern till klientanvändarna, och först
        // efter lyckad sändning markeras alla öppna rader påminda.
        if (!body.komplettering_id) {
          const utfall = await paminnMedMejl(db, {
            tenantId: body.tenant_id,
            paminddAv: konsult,
          });
          return NextResponse.json({ ok: true, ...utfall });
        }
        await markeraPamind(db, {
          tenantId: body.tenant_id,
          kompletteringId: body.komplettering_id,
          paminddAv: konsult,
        });
        return NextResponse.json({ ok: true, antal: 1 });
      }
      case "svar": {
        if (!body.komplettering_id || !body.svar?.trim()) {
          return NextResponse.json({ fel: "komplettering_id och svar krävs" }, { status: 400 });
        }
        await registreraSvar(db, {
          tenantId: body.tenant_id,
          kompletteringId: body.komplettering_id,
          svar: body.svar,
          registreratAv: konsult,
        });
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json(
          { fel: "handling måste vara 'fraga', 'paminn' eller 'svar'" },
          { status: 400 },
        );
    }
  } catch (e) {
    return NextResponse.json(
      { fel: e instanceof Error ? e.message : String(e) },
      { status: 422 },
    );
  }
}
