import type { PGlite } from "@electric-sql/pglite";
import { withTenant } from "@/lib/db/tenant";
import { auditera } from "@/lib/ledger";

// Utgående mejl (WP23): EN adapter-yta, två transporter. Postmark i
// drift (POSTMARK_SERVER_TOKEN), logg-adaptern lokalt/i test — båda
// skriver spårraden i utgaende_mejl så "vad skickades till vem" alltid
// går att läsa ur kunddatan. Valet av Postmark motiveras i ADR-0006.

export type UtgaendeMejl = {
  tenantId: string;
  till: string[];
  amne: string;
  text: string;
};

export interface MejlAdapter {
  namn: string;
  /** Skickar (eller loggar) brevet och skriver spårraden. Kastar vid
   *  transportfel — anroparen avgör om flödet ska stoppas. */
  skicka(db: PGlite, brev: UtgaendeMejl): Promise<void>;
}

async function sparaSparrad(
  db: PGlite,
  brev: UtgaendeMejl,
  adapter: string,
): Promise<void> {
  await withTenant(db, brev.tenantId, async (tx) => {
    await tx.query(
      `INSERT INTO utgaende_mejl (tenant_id, till, amne, brodtext, adapter)
       VALUES ($1, $2, $3, $4, $5)`,
      [brev.tenantId, JSON.stringify(brev.till), brev.amne, brev.text, adapter],
    );
    await auditera(tx, brev.tenantId, "mejl_skickat", {
      till: brev.till,
      amne: brev.amne,
      adapter,
    });
  });
}

/** Lokal/testtransport: brevet "skickas" genom att enbart spårraden
 *  skrivs — ärligt märkt med adapter 'logg' så ingen tror att ett
 *  riktigt mejl gått iväg. */
class LoggMejlAdapter implements MejlAdapter {
  namn = "logg";
  async skicka(db: PGlite, brev: UtgaendeMejl): Promise<void> {
    await sparaSparrad(db, brev, this.namn);
  }
}

/** Postmark-transporten (ADR-0006). Riktig DNS/leverantörskoppling sker
 *  vid deploy — token i env räcker för att aktivera den. */
class PostmarkMejlAdapter implements MejlAdapter {
  namn = "postmark";
  constructor(
    private token: string,
    private fran: string,
  ) {}

  async skicka(db: PGlite, brev: UtgaendeMejl): Promise<void> {
    const svar = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "X-Postmark-Server-Token": this.token,
      },
      body: JSON.stringify({
        From: this.fran,
        To: brev.till.join(","),
        Subject: brev.amne,
        TextBody: brev.text,
        MessageStream: "outbound",
      }),
    });
    if (!svar.ok) {
      const detalj = await svar.text().catch(() => "");
      throw new Error(`Postmark svarade ${svar.status}: ${detalj.slice(0, 200)}`);
    }
    await sparaSparrad(db, brev, this.namn);
  }
}

export function hamtaMejlAdapter(): MejlAdapter {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (token) {
    return new PostmarkMejlAdapter(token, process.env.MAIL_FROM ?? "grundbok@localhost");
  }
  return new LoggMejlAdapter();
}
