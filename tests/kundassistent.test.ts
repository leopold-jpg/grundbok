import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { withTenant } from "../src/lib/db/tenant";
import { handleProposal, decideProposal, type Principal } from "../src/lib/decisions";
import { exempelProposal } from "./helpers";
import { taEmotUnderlag } from "../src/lib/intake";
import {
  svaraPaKundfraga,
  eskaleraKundfraga,
  listaKundfragor,
  besvaraKundfraga,
} from "../src/modules/kundassistent";

// WP22: kundassistenten — svarar ENDAST om egna underlag och verifikat,
// aldrig rådgivning; fallback är eskalering till byråns kö med
// underlaget länkat. Deterministisk med flit: gränsen "aldrig råd" ska
// inte bero på en modells omdöme.

process.env.GRUNDBOK_FORCE_FALLBACK = "1";

const db = await createDb();

const principal: Principal = {
  typ: "intern",
  tenant_id: "kund_a",
  module: "bokforing",
  scopes: ["proposals:write"],
  namn: "test",
};

// Ett bokfört verifikat (kaffefakturan) + ett pending-förslag som grund.
const bokford = exempelProposal({ affarshandelsedatum: "2026-03-15" });
await handleProposal(db, principal, bokford);
await decideProposal(db, {
  tenantId: "kund_a",
  proposalId: bokford.id,
  outcome: "approved",
  decidedBy: "konsult:test",
});

test("rådgivningsfrågor avböjs ALLTID med eskaleringserbjudande — aldrig ett råd", async () => {
  for (const fraga of [
    "Får jag dra av momsen på representation?",
    "Hur bokför jag en leasingbil?",
    "Vilken momssats gäller för böcker?",
    "Ska jag periodisera hyran?",
    "Kan ni hjälpa mig med min K10 och utdelning?",
  ]) {
    const svar = await svaraPaKundfraga(db, {
      tenantId: "kund_a",
      fraga,
      stalldAv: "klient:test",
    });
    assert.equal(svar.typ, "radgivning_avbojd", fraga);
    assert.equal(svar.erbjud_eskalering, true);
    assert.match(svar.svar, /revisor/);
  }
});

test("statusfråga: svarar ur den härledda kedjan, aldrig påhittade siffror", async () => {
  // Inga INLÄMNADE underlag ännu (direktförslaget ovan är byråns eget).
  const tomt = await svaraPaKundfraga(db, {
    tenantId: "kund_a",
    fraga: "Har ni fått mina kvitton?",
    stalldAv: "klient:test",
  });
  assert.equal(tomt.typ, "status");
  assert.match(tomt.svar, /inte lämnat in något underlag/);

  // Ett inlämnat underlag (ingen aktiv agent i denna db → förblir
  // mottaget) syns direkt i statusen.
  await taEmotUnderlag(db, {
    tenantId: "kund_a",
    kalla: "app",
    inlamnadAv: "klient:test",
    innehall: { typ: "text", text: "Kvitto: Statusbolaget AB\n2026-07-05\nSumma: 100,00 kr" },
  });
  const svar = await svaraPaKundfraga(db, {
    tenantId: "kund_a",
    fraga: "Hur går det med mina underlag?",
    stalldAv: "klient:test",
  });
  assert.equal(svar.typ, "status");
  assert.match(svar.svar, /1 underlag totalt/);
  assert.match(svar.svar, /1 mottagna som väntar på tolkning/);
});

test("fakturafråga: motpart + månad → beloppet och läget ur egna verifikat", async () => {
  const svar = await svaraPaKundfraga(db, {
    tenantId: "kund_a",
    fraga: "Vad var fakturan från Kafferosteriet i mars?",
    stalldAv: "klient:test",
  });
  assert.equal(svar.typ, "faktura");
  assert.match(svar.svar, /Kafferosteriet Exempel AB/);
  assert.match(svar.svar, /1 060,00 kr/);
  assert.match(svar.svar, /bokförd som verifikation/);
});

test("momsfråga: summan ur egna verifikat för namngiven månad", async () => {
  const svar = await svaraPaKundfraga(db, {
    tenantId: "kund_a",
    fraga: "Hur mycket moms blev det i mars?",
    stalldAv: "klient:test",
  });
  assert.equal(svar.typ, "moms");
  // Kaffefakturans ingående moms: 60,00 kr (konto 2641).
  assert.match(svar.svar, /60,00 kr ingående/);
});

test("okänd fråga → ärligt vet-ej med eskalering; tom fråga vägras", async () => {
  const svar = await svaraPaKundfraga(db, {
    tenantId: "kund_a",
    fraga: "Vad tycker du om vädret?",
    stalldAv: "klient:test",
  });
  assert.equal(svar.typ, "vet_ej");
  assert.equal(svar.erbjud_eskalering, true);

  await assert.rejects(
    svaraPaKundfraga(db, { tenantId: "kund_a", fraga: "   ", stalldAv: "klient:test" }),
    /tom/,
  );
});

test("eskalering: ärende i byråns kö med underlaget länkat; byråns svar sluter kedjan", async () => {
  const underlag = await taEmotUnderlag(db, {
    tenantId: "kund_a",
    kalla: "app",
    inlamnadAv: "klient:test",
    innehall: { typ: "text", text: "Kvitto: Obskyra Leverantören AB\n2026-07-01\nSumma: 500,00 kr" },
  });

  const arende = await eskaleraKundfraga(db, {
    tenantId: "kund_a",
    fraga: "Får jag dra av det här?",
    underlagId: underlag.underlag_id,
    stalldAv: "klient:test",
  });

  const lista = await listaKundfragor(db, "kund_a");
  const rad = lista.find((f) => f.id === arende.id);
  assert.ok(rad);
  assert.equal(rad!.status, "open");
  assert.equal(rad!.underlag_id, underlag.underlag_id);

  await besvaraKundfraga(db, {
    tenantId: "kund_a",
    fragaId: arende.id,
    svar: "Nej — privat kostnad. Vi tar det på avstämningen.",
    besvaradAv: "konsult:test",
  });
  const efter = (await listaKundfragor(db, "kund_a")).find((f) => f.id === arende.id)!;
  assert.equal(efter.status, "besvarad");
  assert.match(efter.svar ?? "", /privat kostnad/);

  // Dubbelbesvarning vägras — kedjan är sluten.
  await assert.rejects(
    besvaraKundfraga(db, {
      tenantId: "kund_a",
      fragaId: arende.id,
      svar: "igen",
      besvaradAv: "konsult:test",
    }),
    /redan besvarad/,
  );
});

test("tenant-gränsen: kund_b:s assistent ser ingenting av kund_a", async () => {
  const svar = await svaraPaKundfraga(db, {
    tenantId: "kund_b",
    fraga: "Vad var fakturan från Kafferosteriet i mars?",
    stalldAv: "klient:test",
  });
  // Motparten finns inte i kund_b:s värld → vet_ej, inte ett svar.
  assert.equal(svar.typ, "vet_ej");

  // Eskalering kan inte länka en annan tenants underlag.
  const underlagA = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ id: string }>(`SELECT id FROM underlag LIMIT 1`),
  );
  await assert.rejects(
    eskaleraKundfraga(db, {
      tenantId: "kund_b",
      fraga: "test",
      underlagId: underlagA.rows[0].id,
      stalldAv: "klient:test",
    }),
    /Underlaget finns inte/,
  );

  assert.deepEqual(await listaKundfragor(db, "kund_b"), []);
});
