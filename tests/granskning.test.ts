// Regressionstester för WP34-granskningens åtgärdade fynd: mottagar-
// matchningen (diakritik + ordmängd i stället för substring), fallback-
// observationernas fällor (Betalningsmottagare, slutfaktura med a conto)
// och dubblettdetektering för omvänd byggmoms.
process.env.GRUNDBOK_FORCE_FALLBACK = "1";

import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { withTenant } from "../src/lib/db/tenant";
import { mottagareMatchar, normaliseraBolagsnamn, granskaUnderlag } from "../src/lib/granskning";
import { tolkaMedFallback } from "../src/lib/extract/fallback";
import { kontera } from "../src/lib/kontering";
import { skapaAgentNyckel } from "../src/lib/agent-auth";
import { körJobb } from "../src/workers/run-agent";
import { OBSERVATIONS_DEFAULTS, type Extraktion } from "../src/lib/extract/schema";
import { FALL_2_ATA_AVVIKELSE } from "./golden-underlag";

// ------------------------------------------------------ mottagarmatchning

test("mottagarkontroll: diakritikförlust (Cafe/Café) falsklarmar inte", () => {
  assert.equal(mottagareMatchar("Cafe Exempel AB", "Café Exempel AB"), true);
  assert.equal(mottagareMatchar("CAFÉ EXEMPEL AKTIEBOLAG", "Café Exempel AB"), true);
});

test("mottagarkontroll: substring-prefix släpps inte igenom (Bygg AB ≠ Byggmax AB)", () => {
  assert.equal(mottagareMatchar("Byggmax AB", "Bygg AB"), false);
  assert.equal(mottagareMatchar("Byggmästarna Andersson AB", "Bygg Exempel AB"), false);
});

test("mottagarkontroll: ordmängdsdelmängd matchar (kortform av eget namn)", () => {
  assert.equal(mottagareMatchar("Exempel", "Café Exempel AB"), true);
  assert.equal(normaliseraBolagsnamn("Café Exempel AB"), "cafe exempel");
});

// ------------------------------------------------- fallback-observationer

test("fallback: 'Betalningsmottagare: <leverantör>' i betalfoten fångas inte som fakturamottagare", () => {
  const text = `FAKTURA
Byggfirman Exempel AB
Org.nr 556999-0001

Fakturadatum: 2026-07-01
Avser: Material

Nettobelopp: 1 000,00 kr
Att betala: 1 250,00 kr

Betalningsmottagare: Byggfirman Exempel AB
Bankgiro: 123-4567`;
  assert.equal(tolkaMedFallback(text).mottagare, null);
});

test("fallback: slutfaktura som avräknar a conto är INTE ett förskott", () => {
  const text = `FAKTURA
Maskinimporten Exempel AB

Fakturadatum: 2026-07-10
Avser: Slutfaktura espressomaskin

Nettobelopp: 10 000,00 kr
Avgår tidigare a conto-betalning: -5 000,00 kr
Att betala: 7 500,00 kr`;
  assert.equal(tolkaMedFallback(text).forskott, false);
});

test("fallback: ren förskottsfaktura detekteras fortsatt", () => {
  const text = `FAKTURA
Maskinimporten Exempel AB

Fakturadatum: 2026-07-05
Avser: Förskott 50 % espressomaskin

Nettobelopp: 10 000,00 kr
Att betala: 12 500,00 kr`;
  assert.equal(tolkaMedFallback(text).forskott, true);
});

// -------------------------------------------- omvänd moms: kontering-vakt

const omvandExtraktion = (moms_ore: number | null): Extraktion => ({
  ...OBSERVATIONS_DEFAULTS,
  motpart: "Underentreprenad Exempel AB",
  beskrivning: "Markarbeten",
  datum: "2026-07-01",
  netto_ore: 1_000_000,
  moms_ore,
  brutto_ore: null,
  momssats_angiven: null,
  kategori: "byggtjanst",
  betalsatt: "faktura",
});

test("omvänd byggmoms: 0 kr moms på fakturan är korrekt — ingen avvikelseflagga", () => {
  const f = kontera(omvandExtraktion(0), "kund_b");
  assert.ok(!f.flaggor.some((fl) => fl.id === "momssats_avviker"));
});

test("omvänd byggmoms: DEBITERAD moms på fakturan flaggas (fel hos säljaren)", () => {
  const f = kontera(omvandExtraktion(120_000), "kund_b");
  const flagga = f.flaggor.find((fl) => fl.id === "momssats_avviker");
  assert.ok(flagga, "debiterad moms på omvänd faktura ska flaggas");
  assert.equal(flagga.niva, "varning");
  assert.ok(flagga.text.includes("utan moms"));
});

// --------------------------------------- dubblett vid omvänd byggmoms

test("dubblett: omvänd byggmoms-faktura (debetsumma ≠ dokumenttotal) fångas ändå", async () => {
  const db = await createDb();
  const { id: agentId } = await skapaAgentNyckel(db, {
    tenantId: "kund_b",
    module: "bokforing",
    scopes: ["proposals:write"],
    namn: "granskning-dubblett-agent",
    template: { id: "bokforing", major: "1" },
  });
  const kor = async (jobbId: string) => {
    const doc = await withTenant(db, "kund_b", async (tx) => {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO documents (tenant_id, raw) VALUES ($1, $2) RETURNING id`,
        ["kund_b", FALL_2_ATA_AVVIKELSE],
      );
      return r.rows[0].id;
    });
    const utfall = await körJobb(db, {
      job_id: jobbId,
      tenant_id: "kund_b",
      module: "bokforing",
      trigger: "test",
      agent_id: agentId,
      payload_ref: `document:${doc}`,
    });
    assert.equal(utfall.utfall, "klar");
    return withTenant(db, "kund_b", (tx) =>
      tx
        .query<{ flaggor: { id: string }[] }>(`SELECT flaggor FROM proposals WHERE id = $1`, [
          (utfall as { proposal_id: string }).proposal_id,
        ])
        .then((r) => r.rows[0].flaggor.map((f) => f.id)),
    );
  };

  const forsta = await kor("granskning-dubblett-a");
  assert.ok(!forsta.includes("dubblett_misstankt"));
  // Samma omvända faktura igen: dokumenttotalen (netto) matchar den
  // lagrade leverantörsskuldraden (största krediten) — flaggas.
  const andra = await kor("granskning-dubblett-b");
  assert.ok(andra.includes("dubblett_misstankt"), `flaggor andra körningen: ${andra.join(", ")}`);
});

// --------------------------------------- mall-lös agent kör inga paket

test("mall-lös agent hos byggtenant: ÄTA-regeln (bygg-paketet) körs inte", async () => {
  const db = await createDb();
  const extraktion = tolkaMedFallback(FALL_2_ATA_AVVIKELSE);
  // Med explicit tom paketlista (mall-lös körning) — ingen ÄTA-flagga...
  const utan = await granskaUnderlag(db, "kund_b", extraktion, {
    tenantNamn: "Bygg Exempel AB",
    tenantMall: "bygg",
    aktivaPaket: [],
  });
  assert.ok(!utan.flaggor.some((f) => f.id === "ata_avvikelse"));
  // ...men med bygg-paketet aktivt flaggas avvikelsen.
  const med = await granskaUnderlag(db, "kund_b", extraktion, {
    tenantNamn: "Bygg Exempel AB",
    tenantMall: "bygg",
    aktivaPaket: ["bygg"],
  });
  assert.ok(med.flaggor.some((f) => f.id === "ata_avvikelse"));
});
