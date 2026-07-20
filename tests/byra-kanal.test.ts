import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { PgliteAuth } from "../src/auth/pglite-auth";
import { kundfragorForByra } from "../src/ytor/byra";
import { eskaleraKundfraga, besvaraKundfraga } from "../src/modules/kundassistent";
import { halsa } from "../src/ytor/operator";
import { taEmotUnderlag } from "../src/lib/intake";
import { taEmotInboundMejl } from "../src/lib/mejl/inbound";

// WP24: byråsidan av kanalen — fliken "Frågor" är byrå-scopad som allt
// annat i /byra, och operatörskonsolens intagsaggregat visar veckor och
// källor men aldrig innehåll.

process.env.GRUNDBOK_FORCE_FALLBACK = "1";

const db = await createDb();
const auth = new PgliteAuth(db);
const inloggning = await auth.login("konsult.ett@byran-exempel.se", "grundbok-dev");
const session = (await auth.session(inloggning!.token))!;

test("kundfrågorna är byrå-scopade: 'alla' samlar byråns klienter, okänd klient ger tomt", async () => {
  const iA = await eskaleraKundfraga(db, {
    tenantId: "kund_a",
    fraga: "Får jag dra av detta?",
    stalldAv: "klient:test",
  });
  await eskaleraKundfraga(db, {
    tenantId: "kund_b",
    fraga: "Hur funkar moms?",
    stalldAv: "klient:test",
  });

  const alla = await kundfragorForByra(db, session, "alla");
  assert.ok(alla.some((f) => f.tenant_id === "kund_a" && f.tenant_namn === "Café Exempel AB"));
  assert.ok(alla.some((f) => f.tenant_id === "kund_b"));

  const baraA = await kundfragorForByra(db, session, "kund_a");
  assert.ok(baraA.every((f) => f.tenant_id === "kund_a"));

  // Tenant utanför byrån (eller påhittad): tom lista — inget läcker.
  assert.deepEqual(await kundfragorForByra(db, session, "annan_byras_kund"), []);

  // Besvarad fråga sorteras efter öppna och bär svaret.
  await besvaraKundfraga(db, {
    tenantId: "kund_a",
    fragaId: iA.id,
    svar: "Nej, privat.",
    besvaradAv: session.user.id,
  });
  const efter = await kundfragorForByra(db, session, "alla");
  assert.equal(efter[efter.length - 1].status, "besvarad");
});

test("operatörens intagsaggregat: underlag per vecka och källa — aldrig innehåll", async () => {
  await taEmotUnderlag(db, {
    tenantId: "kund_a",
    kalla: "app",
    inlamnadAv: "klient:test",
    innehall: { typ: "text", text: "Kvitto: Aggregatbolaget AB\n2026-07-06\nSumma: 10,00 kr" },
  });
  await taEmotUnderlag(db, {
    tenantId: "kund_b",
    kalla: "api",
    inlamnadAv: "agent:test",
    innehall: { typ: "text", text: "Kvitto: Aggregatbolaget AB\n2026-07-06\nSumma: 20,00 kr" },
  });

  const h = await halsa(db);
  const kanaler = new Set(h.intag_per_vecka.map((r) => r.kalla));
  assert.ok(kanaler.has("app"));
  assert.ok(kanaler.has("api"));
  assert.ok(h.intag_per_vecka.every((r) => r.antal >= 1));
  // Aggregatet bär vecka/källa/antal — inga fält med kundinnehåll.
  for (const rad of h.intag_per_vecka) {
    assert.deepEqual(Object.keys(rad).sort(), ["antal", "kalla", "vecka"]);
  }
});

test("karantänen syns i klientvyns data — utan innehåll", async () => {
  const utfall = await taEmotInboundMejl(db, {
    till: ["kvitto+kund_a@inbound.grundbok.example"],
    fran: "okand@extern.se",
    amne: "Hemligt innehåll som inte får lagras",
    text: "Själva brevet — får aldrig in i systemet.",
    bilagor: [],
  });
  assert.equal(utfall.status, "karantan");

  const { listaKarantan } = await import("../src/lib/mejl/inbound");
  const rader = await listaKarantan(db, "kund_a");
  assert.equal(rader.length, 1);
  // Ämnesraden är metadata och får visas; brödtexten finns ingenstans.
  assert.deepEqual(Object.keys(rader[0]).sort(), [
    "amne",
    "antal_bilagor",
    "fran",
    "id",
    "mottaget",
  ]);
});
