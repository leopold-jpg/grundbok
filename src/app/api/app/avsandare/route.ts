import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { kravKlient } from "@/auth/session";
import { listaAvsandare, laggTillAvsandare, taBortAvsandare } from "@/lib/mejl/avsandare";
import { inboundAdress } from "@/lib/mejl/inbound";

export const runtime = "nodejs";

// Klientens registrerade avsändaradresser (WP23): endast mejl från
// dessa släpps in i intake-flödet. Klienten hanterar listan i appen;
// byrån ser den i klientvyn. Tenanten kommer alltid ur sessionen.

export async function GET(req: Request) {
  const db = await getDb();
  const krav = await kravKlient(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  return NextResponse.json({
    mejladress: inboundAdress(krav.tenantId),
    avsandare: await listaAvsandare(db, krav.tenantId),
  });
}

export async function POST(req: Request) {
  const db = await getDb();
  const krav = await kravKlient(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  if (!email?.trim()) return NextResponse.json({ fel: "email krävs" }, { status: 400 });

  try {
    const rad = await laggTillAvsandare(db, {
      tenantId: krav.tenantId,
      email,
      registreradAv: `klient:${krav.session.user.id}`,
    });
    return NextResponse.json(rad, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { fel: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}

export async function DELETE(req: Request) {
  const db = await getDb();
  const krav = await kravKlient(db, req);
  if ("http" in krav) return NextResponse.json({ fel: krav.fel }, { status: krav.http });

  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return NextResponse.json({ fel: "id krävs" }, { status: 400 });

  try {
    await taBortAvsandare(db, {
      tenantId: krav.tenantId,
      avsandareId: id,
      borttagenAv: `klient:${krav.session.user.id}`,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { fel: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
