import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { parsePostmarkInbound, taEmotInboundMejl } from "@/lib/mejl/inbound";

export const runtime = "nodejs";

// POST /api/intake/mail (WP23) — inbound-webhooken. Leverantörens
// payload (Postmark, ADR-0006) översätts till det generiska formatet
// innan något rör flödet; riktig DNS/leverantörskoppling sker vid
// deploy, lokalt testas med inspelad payload. Svaret är alltid 200 för
// igenkänd struktur — leverantören ska aldrig retry-storma; utfallet
// (mottaget/karantän/ignorerad) står i kroppen och i audit-loggen.
export async function POST(req: Request) {
  // Delad webhook-hemlighet: obligatorisk när INBOUND_MAIL_SECRET är
  // satt (deploy-läget). Utan env-nyckel (lokal dev) släpps anropet
  // igenom — miljövillkoret står på deploy-checklistan.
  const hemlighet = process.env.INBOUND_MAIL_SECRET;
  if (hemlighet) {
    const angiven =
      req.headers.get("x-grundbok-secret") ??
      new URL(req.url).searchParams.get("secret");
    if (angiven !== hemlighet) {
      return NextResponse.json({ fel: "ogiltig webhook-hemlighet" }, { status: 401 });
    }
  }

  const raw = await req.json().catch(() => null);
  const mejl = parsePostmarkInbound(raw);
  if (!mejl) {
    return NextResponse.json({ status: "ignorerad", skal: "oigenkänd payload" });
  }

  const db = await getDb();
  const utfall = await taEmotInboundMejl(db, mejl);
  // Minimalt svar till leverantören — inga underlags-id:n ut.
  return NextResponse.json(
    utfall.status === "mottaget"
      ? {
          status: "mottaget",
          antal_underlag: utfall.underlag.length,
          hoppade_bilagor: utfall.hoppade_bilagor.length,
        }
      : { status: utfall.status },
  );
}
