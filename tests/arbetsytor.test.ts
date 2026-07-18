// WP29: gräns-smoke för arbetsyte-passet (WP26–WP28). Tre regler:
// 1) attestkons tangentbordsflöde fungerar utan mus (den rena maskinen),
// 2) operatörens NYA vyer (sparkline, livslinje, tenantdrift, hälsa per
//    modul) läcker aldrig förslags-innehåll,
// 3) Cmd+K respekterar roll — konsulten ser aldrig operatörskommandon.
process.env.GRUNDBOK_FORCE_FALLBACK = "1";

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attestMaskin,
  nyttLage,
  type AttestEffekt,
  type AttestHandelse,
  type AttestLage,
} from "../src/ytor/komponenter/attest-tangentbord";
import { byggKommandon, filtreraKommandon } from "../src/ytor/komponenter/kommandon";
import { createDb } from "../src/lib/db/client";
import { provisionAgent, pausaAgent, ateruppta } from "../src/lib/provisioning";
import { proposalsPort } from "../src/lib/proposals-port";
import { flottoversikt, agentDetalj, halsa } from "../src/ytor/operator";
import { PgliteKo } from "../src/lib/queue";
import { exempelProposal } from "./helpers";

// ------------------------------------------------ attestkons tangentbord

/** Kör en händelsesekvens genom maskinen och samla effekterna. */
function kor(lage: AttestLage, handelser: AttestHandelse[]) {
  const effekter: AttestEffekt[] = [];
  for (const h of handelser) {
    const steg = attestMaskin(lage, h);
    lage = steg.lage;
    effekter.push(...steg.effekter);
  }
  return { lage, effekter };
}

test("tangentbordsflödet: 5 förslag attesteras utan mus (A×5 + commit)", () => {
  const ids = ["p1", "p2", "p3", "p4", "p5"];
  const { lage, effekter } = kor(nyttLage(ids), [
    { typ: "attestera" },
    { typ: "attestera" },
    { typ: "attestera" },
    { typ: "attestera" },
    { typ: "attestera" },
    { typ: "commit" }, // ångra-fönstret för det sista löper ut
  ]);
  const skickade = effekter.filter((e) => e.typ === "skicka");
  assert.equal(skickade.length, 5);
  assert.deepEqual(
    skickade.map((e) => e.id),
    ids,
  );
  assert.ok(skickade.every((e) => e.beslut === "godkand"));
  assert.equal(lage.rader.length, 0);
  assert.equal(lage.vantande, null);
});

test("ångra: U innan commit återställer raden på sin plats — inget skickas", () => {
  const { lage, effekter } = kor(nyttLage(["p1", "p2", "p3"]), [
    { typ: "ner" }, // välj p2
    { typ: "attestera" },
    { typ: "angra" },
  ]);
  assert.equal(effekter.filter((e) => e.typ === "skicka").length, 0);
  assert.deepEqual(lage.rader, ["p1", "p2", "p3"]);
  assert.equal(lage.index, 1); // tillbaka på den återställda raden
  // Effekten berättar för vyn vad som återställdes.
  assert.deepEqual(effekter, [{ typ: "aterstalld", id: "p2" }]);
});

test("nästa beslut committar det väntande — högst ETT beslut i ångra-fönstret", () => {
  const { lage, effekter } = kor(nyttLage(["p1", "p2"]), [
    { typ: "attestera" }, // stagar p1
    { typ: "avvisa-oppna" },
    { typ: "avvisa-skicka", motivering: "fel motpart" }, // committar p1, stagar p2
  ]);
  const skickade = effekter.filter((e) => e.typ === "skicka");
  assert.deepEqual(skickade, [{ typ: "skicka", id: "p1", beslut: "godkand", motivering: undefined }]);
  assert.equal(lage.vantande?.id, "p2");
  assert.equal(lage.vantande?.beslut, "avvisad");
  assert.equal(lage.vantande?.motivering, "fel motpart");
});

test("avvisning kräver motivering, och serverdata återuppväcker aldrig en stagad rad", () => {
  // Tom motivering → ingen effekt, fältet förblir öppet för rättelse.
  let steg = kor(nyttLage(["p1"]), [{ typ: "avvisa-oppna" }, { typ: "avvisa-skicka", motivering: "   " }]);
  assert.equal(steg.effekter.length, 0);
  assert.deepEqual(steg.lage.rader, ["p1"]);

  // En stagad rad ligger kvar som pending hos servern tills commit —
  // en mellankommande hämtning får inte lägga tillbaka den i listan.
  steg = kor(nyttLage(["p1", "p2"]), [
    { typ: "attestera" },
    { typ: "rader", rader: ["p1", "p2"] },
  ]);
  assert.deepEqual(steg.lage.rader, ["p2"]);
  assert.equal(steg.lage.vantande?.id, "p1");
});

// --------------------------------------------------------- Cmd+K + roll

test("Cmd+K respekterar roll: konsulten ser aldrig operatörskommandon", () => {
  const konsult = byggKommandon({
    roll: "konsult",
    klienter: [{ id: "kund_a", namn: "Café Exempel AB" }],
    motparter: ["Kafferosteriet Exempel AB"],
  });
  // Inga operatörsgrupper eller operatörs-id:n, oavsett vad som skickas in.
  assert.ok(konsult.every((k) => !["bolag", "agent", "atgard"].includes(k.grupp)));
  assert.ok(konsult.every((k) => !k.id.startsWith("atgard:") && !k.id.startsWith("bolag:")));
  // …men konsultens egna kommandon finns.
  assert.ok(konsult.some((k) => k.id === "klient:kund_a"));
  assert.ok(konsult.some((k) => k.id === "motpart:Kafferosteriet Exempel AB"));

  const operator = byggKommandon({
    roll: "operator",
    bolag: [{ tenant_id: "kund_a", tenant_namn: "Café Exempel AB", byra: "Byrån Exempel AB" }],
    agenter: [{ agent_id: "a1", display_name: "kvittoagent", tenant_namn: "Café Exempel AB" }],
  });
  assert.ok(operator.some((k) => k.id === "atgard:provisionera"));
  assert.ok(operator.some((k) => k.id === "bolag:kund_a"));
  // Operatören har inga konsultkommandon (flikar, klientval, motpartssök).
  assert.ok(operator.every((k) => !["klient", "motpart"].includes(k.grupp)));

  // Sökningen träffar på alla ordled.
  const traff = filtreraKommandon(operator, "provisionera agent");
  assert.deepEqual(
    traff.map((k) => k.id),
    ["atgard:provisionera"],
  );
});

// ---------------------------------- operatörens nya vyer läcker inget

const db = await createDb();

// En agent med ett pending-förslag (kund_a:s seedade policy är manuell),
// därefter pausad + återupptagen så livslinjen har hela kedjan.
const agent = await provisionAgent(
  db,
  { tenantId: "kund_a", mall: "bokforing", displayName: "Smokeagenten" },
  "test:wp29",
);
const p = exempelProposal();
const svar = await proposalsPort(db, `Bearer ${agent.nyckel}`, p);
assert.equal(svar.http, 202); // pending — kund_a:s policy attesterar allt
await pausaAgent(db, "kund_a", agent.agent_id);
await ateruppta(db, "kund_a", agent.agent_id);

// Ett kö-jobb så hälsan har något att räkna — kuvertet bär driftfält,
// payload_ref är en referens (aldrig rå data i kön).
await new PgliteKo(db).send({
  job_id: "wp29-job",
  tenant_id: "kund_a",
  agent_id: agent.agent_id,
  module: "bokforing",
  trigger: "test",
  payload_ref: "document:00000000-0000-4000-8000-000000000001",
});

test("sparkline-datat är antal per dygn — summan stämmer med 7-dagarsräknaren", async () => {
  const flotta = await flottoversikt(db);
  const rad = flotta.find((r) => r.agent_id === agent.agent_id);
  assert.ok(rad);
  assert.equal(rad.forslag_dagar.length, 7);
  assert.ok(rad.forslag_dagar.every((n) => typeof n === "number" && n >= 0));
  assert.equal(
    rad.forslag_dagar.reduce((s, n) => s + n, 0),
    rad.forslag_7d,
  );
  assert.equal(rad.forslag_7d, 1);
});

test("livslinjen är skapad → pausad → återupptagen, och tenantdriften är siffror", async () => {
  const detalj = await agentDetalj(db, agent.agent_id);
  assert.ok(detalj);
  assert.deepEqual(
    detalj.livslinje.map((h) => h.handelse),
    ["skapad", "pausad", "aterupptagen"],
  );
  // Kronologisk ordning med verkliga tidsstämplar.
  const tider = detalj.livslinje.map((h) => h.tid);
  assert.deepEqual(tider, [...tider].sort());
  assert.equal(detalj.tenant_drift.ko_djup, 1);
  assert.equal(detalj.tenant_drift.senaste_korning, null); // ingen körning arkiverad
});

test("hälsan: äldsta väntande och per modul — drift, aldrig innehåll", async () => {
  const h = await halsa(db);
  assert.ok(h.ko_djup >= 1);
  assert.ok(h.aldsta_vantande !== null);
  const bokforing = h.per_modul.find((m) => m.module === "bokforing");
  assert.ok(bokforing && bokforing.ko_djup >= 1);
  assert.equal(typeof bokforing.omforsok_24h, "number");
});

test("operatörsregeln i de nya vyerna: inget förslags-innehåll någonstans", async () => {
  // Kaffebönor-texten ligger i summary/motpart på förslaget — den får
  // inte förekomma i något av de nya aggregatens svar.
  const allt = JSON.stringify([
    await flottoversikt(db),
    await agentDetalj(db, agent.agent_id),
    await halsa(db),
  ]);
  assert.ok(!allt.includes("Kaffebönor"));
  assert.ok(!allt.includes("Kafferosteriet"));
  assert.ok(!allt.includes("belopp_ore") || !allt.includes("summary"));
  // Livslinjen bär aldrig payload — bara händelse + tid.
  const detalj = await agentDetalj(db, agent.agent_id);
  for (const h of detalj!.livslinje) {
    assert.deepEqual(Object.keys(h).sort(), ["handelse", "tid"]);
  }
});
