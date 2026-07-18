// WP13 (ADR-0004): flottöversikten i operatörskonsolen. Lib-nivå som
// övriga ytor-tester — flottoversikt/agentDetalj anropas direkt mot
// seedad PGlite. Operatörsregeln gäller vyn fullt ut: aggregat och
// driftmetadata, aldrig summary/belopp/motpart.
process.env.GRUNDBOK_FORCE_FALLBACK = "1";

import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { provisionAgent, pausaAgent } from "../src/lib/provisioning";
import { proposalsPort } from "../src/lib/proposals-port";
import { decideProposal } from "../src/lib/decisions";
import { flottoversikt, agentDetalj, KORRIGERINGSTROSKEL } from "../src/ytor/operator";
import { mallRegistret } from "../src/mallar/registry";
import { exempelProposal } from "./helpers";

const db = await createDb();

// Explicit policy (upsert): kund_a:s seedade bokforing-policy är fullt
// manuell, och mallförval seedar bara saknade rader — sekvensens auto-
// godkännande kräver att restaurangnivån sätts uttryckligen.
const resto = await provisionAgent(
  db,
  {
    tenantId: "kund_a",
    mall: "bokforing-restaurang",
    displayName: "Flottans restoagent",
    policy: mallRegistret["bokforing-restaurang"].defaultPolicy,
  },
  "test:wp13",
);

// Kvalitetssekvensen: godkänd → auto → avvisad ger 1/3 i både auto- och
// korrigeringsandel (1/3 > tröskeln 0,3 → varningen ska tända).
const p1 = exempelProposal();
await proposalsPort(db, `Bearer ${resto.nyckel}`, p1);
await decideProposal(db, {
  tenantId: "kund_a",
  proposalId: p1.id,
  outcome: "approved",
  decidedBy: "konsult@byran.se",
});
const p2 = exempelProposal({ confidence: 0.95 });
const autoSvar = await proposalsPort(db, `Bearer ${resto.nyckel}`, p2);
assert.equal(autoSvar.http, 201);
const p3 = exempelProposal({ confidence: 0.7 });
await proposalsPort(db, `Bearer ${resto.nyckel}`, p3);
await decideProposal(db, {
  tenantId: "kund_a",
  proposalId: p3.id,
  outcome: "rejected",
  decidedBy: "konsult@byran.se",
  reason: "Fel underlag",
});

async function restoRad() {
  const flotta = await flottoversikt(db);
  const rad = flotta.find((r) => r.agent_id === resto.agent_id);
  assert.ok(rad, "restoagenten saknas i flottan");
  return rad;
}

test("flottöversikten: andelar, mall + version ur registret, byrå och tenant", async () => {
  const rad = await restoRad();
  assert.equal(rad.display_name, "Flottans restoagent");
  assert.equal(rad.tenant_namn, "Café Exempel AB");
  assert.equal(rad.byra, "Byrån Exempel AB");
  assert.equal(rad.template_id, "bokforing-restaurang");
  assert.equal(rad.template_version, "1");
  // Major-pekaren löser mot registrets exakta version.
  assert.equal(rad.mall_aktuell_version, "1.0.0");
  assert.equal(rad.forslag_7d, 3);
  assert.equal(rad.auto_7d, 1);
  assert.equal(rad.rejected_7d, 1);
  assert.equal(rad.corrected_7d, 0);
  assert.ok(Math.abs((rad.andel_auto ?? 0) - 1 / 3) < 1e-9);
  assert.ok(Math.abs((rad.andel_korrigerade ?? 0) - 1 / 3) < 1e-9);
  assert.ok(rad.senaste_aktivitet !== null);
});

test("varningar: korrigeringsandel över tröskeln tänder, aktivitet släcker inaktiv", async () => {
  const rad = await restoRad();
  assert.ok(1 / 3 > KORRIGERINGSTROSKEL);
  assert.ok(rad.varningar.includes("hog_korrigeringsandel"));
  // Färska förslag finns → ingen inaktivitetsvarning.
  assert.ok(!rad.varningar.includes("inaktiv_7d"));
});

test("varningar: aktiv agent utan aktivitet flaggas, pausad är väntat tyst", async () => {
  const bygg = await provisionAgent(
    db,
    { tenantId: "kund_b", mall: "bokforing-bygg", displayName: "Vilande byggagent" },
    "test:wp13",
  );
  let flotta = await flottoversikt(db);
  let rad = flotta.find((r) => r.agent_id === bygg.agent_id);
  assert.ok(rad);
  assert.equal(rad.forslag_7d, 0);
  assert.equal(rad.andel_korrigerade, null);
  assert.ok(rad.varningar.includes("inaktiv_7d"));

  // Pausad agent är väntat inaktiv — varningen gäller bara aktiva.
  await pausaAgent(db, "kund_b", bygg.agent_id);
  flotta = await flottoversikt(db);
  rad = flotta.find((r) => r.agent_id === bygg.agent_id);
  assert.ok(rad && rad.status === "paused");
  assert.ok(!rad.varningar.includes("inaktiv_7d"));
});

test("varningar: mallpekare utanför katalogen är versionsdrift, aldrig en tyst träff", async () => {
  // kund_b, inte kund_a: policyn är per (tenant, modul) och en mall-
  // provisionering kopierar sina förval dit — kund_a:s restaurangpolicy
  // ska stå orörd inför detaljtestet nedan.
  const drift = await provisionAgent(
    db,
    { tenantId: "kund_b", mall: "bokforing-konsult", displayName: "Driftagenten" },
    "test:wp13",
  );
  // Service-vägen: simulera en katalog där agentens major försvunnit.
  await db.query(`UPDATE agents SET template_version = '9' WHERE id = $1`, [drift.agent_id]);
  const flotta = await flottoversikt(db);
  const rad = flotta.find((r) => r.agent_id === drift.agent_id);
  assert.ok(rad);
  assert.equal(rad.mall_aktuell_version, null);
  assert.ok(rad.varningar.includes("versionsdrift"));
});

test("agentdetalj: policyn, nyckelscopes och senaste förslagen som driftrader", async () => {
  const detalj = await agentDetalj(db, resto.agent_id);
  assert.ok(detalj);
  // Policyn är mallens förval, kopierad vid provisioneringen.
  assert.equal(detalj.policy?.max_belopp_ore, 200_000);
  assert.equal(detalj.policy?.min_confidence, 0.85);
  assert.deepEqual(detalj.agent.scopes, ["proposals:write"]);
  assert.equal(detalj.senaste.length, 3);
  const statusar = detalj.senaste.map((p) => p.status).sort();
  assert.deepEqual(statusar, ["approved", "auto_approved", "rejected"]);
  // Driftrader — aldrig innehållsfält.
  for (const p of detalj.senaste) {
    assert.ok(!("summary" in p) && !("motpart" in p) && !("belopp_ore" in p) && !("payload" in p));
  }
  assert.equal(await agentDetalj(db, "00000000-0000-4000-8000-00000000dead"), null);
});

test("operatörsregeln: varken flottan eller detaljen läcker förslags-innehåll", async () => {
  const flotta = await flottoversikt(db);
  const detalj = await agentDetalj(db, resto.agent_id);
  // Kaffebönor-texten finns i summary/motpart på alla tre förslagen —
  // den får inte förekomma någonstans i operatörens svar.
  assert.ok(!JSON.stringify(flotta).includes("Kaffebönor"));
  assert.ok(!JSON.stringify(flotta).includes("Kafferosteriet"));
  assert.ok(!JSON.stringify(detalj).includes("Kaffebönor"));
  assert.ok(!JSON.stringify(detalj).includes("Kafferosteriet"));
});

// Sist i filen: backdateringen ändrar restoagentens telemetri för allt
// som körs efteråt.
test("7-dagarsfönstret: gamla förslag lämnar räknarna men inte senaste aktivitet", async () => {
  // Service-vägen backdaterar agentens samtliga förslag till dag -9 —
  // det låser BÅDE vyns SQL-fönster (created_at > now() - 7 dagar) och
  // JS-sidans inaktivitetströskel i flottoversikt.
  await db.query(
    `UPDATE proposals SET created_at = now() - interval '9 days' WHERE agent_id = $1`,
    [resto.agent_id],
  );
  const flotta = await flottoversikt(db);
  const rad = flotta.find((r) => r.agent_id === resto.agent_id);
  assert.ok(rad);
  assert.equal(rad.forslag_7d, 0);
  assert.equal(rad.auto_7d, 0);
  assert.equal(rad.rejected_7d, 0);
  assert.equal(rad.andel_auto, null);
  assert.equal(rad.andel_korrigerade, null);
  // Senaste aktivitet är historik utan fönster — 9 dagar gammal, inte null.
  assert.ok(rad.senaste_aktivitet !== null);
  // Aktiv agent vars senaste aktivitet passerat 7 dagar → varningen tänds,
  // och korrigeringsvarningen släcks med fönstret.
  assert.ok(rad.varningar.includes("inaktiv_7d"));
  assert.ok(!rad.varningar.includes("hog_korrigeringsandel"));
});
