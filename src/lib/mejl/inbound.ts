import type { PGlite } from "@electric-sql/pglite";
import { withTenant } from "@/lib/db/tenant";
import { auditera } from "@/lib/ledger";
import { taEmotUnderlag, type IntakeUtfall } from "@/lib/intake";
import { arRegistreradAvsandare } from "./avsandare";

// Inbound-mejl (WP23): webhooken tar ett GENERISKT payloadformat —
// leverantören (Postmark, ADR-0006) översätts av en adapter innan något
// rör flödet. Adress per klient: kvitto+<tenant>@inbound.<domän> slås
// upp till tenant → samma intake-port som app och API, källa 'mejl'.
// Avsändarvalidering: endast registrerade adresser släpps in; övriga
// hamnar i karantänlistan — och karantänen lagrar ALDRIG innehållet.

export type InboundBilaga = { filnamn: string; mime: string; base64: string };

export type InboundMejl = {
  /** Alla mottagaradresser (To + Cc) — kvitto+-adressen kan stå var som helst. */
  till: string[];
  fran: string;
  amne: string;
  text: string;
  bilagor: InboundBilaga[];
};

/** Postmark inbound-webhook → generiskt format. Okänd/trasig payload →
 *  null (webhooken svarar 200 utan att processa — leverantören ska
 *  aldrig retry-storma oss för skräp). */
export function parsePostmarkInbound(raw: unknown): InboundMejl | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as {
    From?: unknown;
    FromFull?: { Email?: unknown };
    To?: unknown;
    ToFull?: { Email?: unknown }[];
    CcFull?: { Email?: unknown }[];
    Subject?: unknown;
    TextBody?: unknown;
    Attachments?: { Name?: unknown; ContentType?: unknown; Content?: unknown }[];
  };

  const fran =
    (typeof p.FromFull?.Email === "string" && p.FromFull.Email) ||
    (typeof p.From === "string" && p.From) ||
    "";
  if (!fran) return null;

  const till: string[] = [];
  for (const lista of [p.ToFull, p.CcFull]) {
    if (!Array.isArray(lista)) continue;
    for (const m of lista) {
      if (typeof m?.Email === "string") till.push(m.Email);
    }
  }
  if (till.length === 0 && typeof p.To === "string") {
    till.push(...p.To.split(",").map((s) => s.trim()));
  }
  if (till.length === 0) return null;

  const bilagor: InboundBilaga[] = [];
  if (Array.isArray(p.Attachments)) {
    for (const b of p.Attachments) {
      if (typeof b?.Content !== "string" || typeof b?.ContentType !== "string") continue;
      bilagor.push({
        filnamn: typeof b.Name === "string" ? b.Name : "bilaga",
        mime: b.ContentType,
        base64: b.Content,
      });
    }
  }

  return {
    till,
    fran: fran.trim().toLowerCase(),
    amne: typeof p.Subject === "string" ? p.Subject : "",
    text: typeof p.TextBody === "string" ? p.TextBody : "",
    bilagor,
  };
}

/** kvitto+<tenant>@… ur mottagarlistan → tenant-id (första träffen). */
export function tenantUrAdress(till: string[]): string | null {
  for (const adress of till) {
    const m = adress.trim().toLowerCase().match(/^kvitto\+([a-z][a-z0-9_]{1,62})@/);
    if (m) return m[1];
  }
  return null;
}

export type MailIntakeUtfall =
  | { status: "ignorerad"; skal: string }
  | { status: "karantan"; tenant_id: string }
  | {
      status: "mottaget";
      tenant_id: string;
      underlag: IntakeUtfall[];
      hoppade_bilagor: string[];
    };

/**
 * Hela inbound-flödet som testbar funktion: adressuppslag →
 * avsändarvakt → intake per bilaga (eller textkropp). En trasig bilaga
 * stoppar inte de övriga.
 */
export async function taEmotInboundMejl(
  db: PGlite,
  mejl: InboundMejl,
): Promise<MailIntakeUtfall> {
  const tenantSlug = tenantUrAdress(mejl.till);
  if (!tenantSlug) return { status: "ignorerad", skal: "ingen kvitto+-adress bland mottagarna" };

  const tenant = await db.query<{ id: string }>(`SELECT id FROM tenants WHERE id = $1`, [
    tenantSlug,
  ]);
  if (!tenant.rows[0]) return { status: "ignorerad", skal: "okänd klientadress" };
  const tenantId = tenant.rows[0].id;

  // Avsändarvakten: oregistrerad → karantän, aldrig förslag. Innehållet
  // lagras inte — endast avsändare, ämne och bilagsantal.
  if (!(await arRegistreradAvsandare(db, tenantId, mejl.fran))) {
    await withTenant(db, tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO mejl_karantan (tenant_id, fran, amne, antal_bilagor)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, mejl.fran, mejl.amne.slice(0, 300) || null, mejl.bilagor.length],
      );
      await auditera(tx, tenantId, "mejl_karantan", {
        fran: mejl.fran,
        antalBilagor: mejl.bilagor.length,
      });
    });
    return { status: "karantan", tenant_id: tenantId };
  }

  const inlamnadAv = `mejl:${mejl.fran}`;
  const underlag: IntakeUtfall[] = [];
  const hoppade: string[] = [];

  if (mejl.bilagor.length > 0) {
    for (const bilaga of mejl.bilagor) {
      try {
        underlag.push(
          await taEmotUnderlag(db, {
            tenantId,
            kalla: "mejl",
            inlamnadAv,
            innehall: {
              typ: "fil",
              base64: bilaga.base64,
              mime: bilaga.mime,
              filnamn: bilaga.filnamn,
            },
          }),
        );
      } catch (err) {
        // Ostödd filtyp/trasig bilaga: hoppa, stoppa inte de övriga.
        hoppade.push(
          `${bilaga.filnamn}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Textkroppen blir underlag när mejlet saknar (användbara) bilagor —
  // en vidarebefordrad faktura är ofta ren text.
  if (underlag.length === 0 && mejl.text.trim()) {
    try {
      underlag.push(
        await taEmotUnderlag(db, {
          tenantId,
          kalla: "mejl",
          inlamnadAv,
          innehall: { typ: "text", text: mejl.text },
        }),
      );
    } catch (err) {
      hoppade.push(`textkropp: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { status: "mottaget", tenant_id: tenantId, underlag, hoppade_bilagor: hoppade };
}

/** Klientens inbound-adress — visas i appen och byråns klientvy.
 *  Riktig DNS/leverantörskoppling sker vid deploy (S4). */
export function inboundAdress(tenantId: string): string {
  const doman = process.env.INBOUND_DOMAN ?? "inbound.grundbok.example";
  return `kvitto+${tenantId}@${doman}`;
}

/** Karantänlistan för byråns klientvy (WP24). */
export type KarantanRad = {
  id: string;
  fran: string;
  amne: string | null;
  antal_bilagor: number;
  mottaget: string;
};

export async function listaKarantan(db: PGlite, tenantId: string): Promise<KarantanRad[]> {
  return withTenant(db, tenantId, async (tx) => {
    const r = await tx.query<{
      id: string;
      fran: string;
      amne: string | null;
      antal_bilagor: number;
      mottaget: Date | string;
    }>(`SELECT id, fran, amne, antal_bilagor, mottaget FROM mejl_karantan ORDER BY mottaget DESC`);
    return r.rows.map((rad) => ({
      ...rad,
      antal_bilagor: Number(rad.antal_bilagor),
      mottaget: (rad.mottaget instanceof Date
        ? rad.mottaget
        : new Date(rad.mottaget)
      ).toISOString(),
    }));
  });
}
