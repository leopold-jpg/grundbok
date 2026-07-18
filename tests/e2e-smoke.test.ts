// Tolkningen tvingas till den deterministiska fallbacken (WP34-kedjan
// kör hela workervägen) — inga nätanrop i testsviten.
process.env.GRUNDBOK_FORCE_FALLBACK = "1";

import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { withTenant } from "../src/lib/db/tenant";
import { provisionAgent, pausaAgent } from "../src/lib/provisioning";
import { proposalsPort } from "../src/lib/proposals-port";
import { mallRegistret } from "../src/mallar/registry";
import { skapaAgentNyckel } from "../src/lib/agent-auth";
import { körJobb } from "../src/workers/run-agent";
import { decideProposal } from "../src/lib/decisions";
import {
  hamtaKompletteringar,
  skapaFraga,
  registreraSvar,
  manadsStatus,
} from "../src/lib/kompletteringar";
import { FALL_5_DELMATCHNING } from "./golden-underlag";
import { exempelProposal } from "./helpers";

// Kompletteringspass (punkt 3): hela kedjan som EN smoke — provisionera
// agent → mockat jobb med agentens nyckel genom porten → Proposal med
// mallstämpel (mall_id + mall_version) → agenten i agent_telemetry med
// 1 förslag → pausa → nytt jobb nekas. Varje länk körs mot samma kärna
// som driften: proposalsPort är exakt det POST /api/proposals kör.

const db = await createDb();

test("e2e: provisionering → jobb → mallstämplad proposal → telemetri → paus → nekad", async () => {
  // 1. Provisionera ur agentmallen — nyckeln är svarets engångsvisning.
  const agent = await provisionAgent(
    db,
    { tenantId: "kund_a", mall: "bokforing", displayName: "e2e-smoke-agent" },
    "operator:e2e-smoke",
  );
  assert.match(agent.nyckel, /^gk_/);

  // 2. Mockat jobb med agentens nyckel: ett externt agentjobb är ett
  //    mallstämplat förslag genom porten (ADR-0002: enda ingången).
  const mall = mallRegistret.bokforing;
  const forslag = exempelProposal({
    contract_version: "0.3.0",
    mall_id: mall.id,
    mall_version: mall.version,
  });
  const svar = await proposalsPort(db, `Bearer ${agent.nyckel}`, forslag);
  assert.ok(
    svar.http === 201 || svar.http === 202,
    `porten ska ta emot jobbet, fick ${svar.http}: ${JSON.stringify(svar.body)}`,
  );

  // 3. Proposalraden bär mallstämpeln och pekar på agenten.
  const rad = await db.query<{
    agent_id: string | null;
    mall_id: string | null;
    mall_version: string | null;
  }>(
    `SELECT agent_id, payload->>'mall_id' AS mall_id,
            payload->>'mall_version' AS mall_version
     FROM proposals WHERE id = $1`,
    [forslag.id],
  );
  assert.equal(rad.rows[0]?.agent_id, agent.agent_id);
  assert.equal(rad.rows[0]?.mall_id, mall.id);
  assert.equal(rad.rows[0]?.mall_version, mall.version);

  // 4. Telemetrin härleds ur proposals: exakt 1 förslag på färska agenten.
  const tele = await db.query<{ proposals_7d: string; status: string }>(
    `SELECT proposals_7d, status FROM agent_telemetry WHERE agent_id = $1`,
    [agent.agent_id],
  );
  assert.equal(Number(tele.rows[0]?.proposals_7d), 1);
  assert.equal(tele.rows[0]?.status, "active");

  // 5. Pausa → nytt jobb nekas med 403 (känd men inaktiv — inte 401),
  //    och ingen ny proposal skapas.
  await pausaAgent(db, "kund_a", agent.agent_id);
  const nytt = exempelProposal({
    contract_version: "0.3.0",
    mall_id: mall.id,
    mall_version: mall.version,
  });
  const nekat = await proposalsPort(db, `Bearer ${agent.nyckel}`, nytt);
  assert.equal(nekat.http, 403);

  const efter = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM proposals WHERE agent_id = $1`,
    [agent.agent_id],
  );
  assert.equal(Number(efter.rows[0].n), 1, "pausad agent får inte producera fler förslag");

  // Telemetrin speglar pausen — samma rad, fortfarande 1 förslag.
  const teleEfter = await db.query<{ proposals_7d: string; status: string }>(
    `SELECT proposals_7d, status FROM agent_telemetry WHERE agent_id = $1`,
    [agent.agent_id],
  );
  assert.equal(teleEfter.rows[0]?.status, "paused");
  assert.equal(Number(teleEfter.rows[0]?.proposals_7d), 1);
});

// ================================================== underlagsjakten (WP34)

test("e2e: saknat kvitto → delmatchad proposal → komplettering → fråga → svar → månadschip gul→grön", async () => {
  // Egen databas: månadsgrönt beräknas ur nuläget och ska inte störas
  // av smoken ovan.
  const db2 = await createDb();
  const tenant = "kund_a";

  // 0. Utgångsläget är grönt — inget väntar någonstans.
  assert.equal((await manadsStatus(db2, tenant)).gron, true);

  // 1. Underlag med saknat kvitto in via workervägen (mallstämplad agent).
  const { id: agentId } = await skapaAgentNyckel(db2, {
    tenantId: tenant,
    module: "bokforing",
    scopes: ["proposals:write"],
    namn: "e2e-underlagsjakt-agent",
    template: { id: "bokforing", major: "1" },
  });
  const doc = await withTenant(db2, tenant, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO documents (tenant_id, raw) VALUES ($1, $2) RETURNING id`,
      [tenant, FALL_5_DELMATCHNING],
    );
    return r.rows[0].id;
  });
  const utfall = await körJobb(db2, {
    job_id: "e2e-underlagsjakt-1",
    tenant_id: tenant,
    module: "bokforing",
    trigger: "e2e",
    agent_id: agentId,
    payload_ref: `document:${doc}`,
  });
  assert.equal(utfall.utfall, "klar");
  const proposalId = (utfall as { proposal_id: string }).proposal_id;

  // 2. Förslaget är delmatchat (missing_receipt persisterad) och pending.
  const prad = await withTenant(db2, tenant, (tx) =>
    tx.query<{ status: string; flaggor: { id: string }[] }>(
      `SELECT status, flaggor FROM proposals WHERE id = $1`,
      [proposalId],
    ),
  );
  assert.equal(prad.rows[0].status, "pending");
  assert.ok(prad.rows[0].flaggor.some((f) => f.id === "missing_receipt"));

  // 3. Kompletteringsraden skapades automatiskt med restbeloppet.
  const komplettering = (await hamtaKompletteringar(db2, tenant)).find(
    (k) => k.proposal_id === proposalId,
  );
  assert.ok(komplettering, "kompletteringsraden saknas");
  assert.equal(komplettering.belopp_ore, 40_000);

  // 4. Konsulten ställer en fråga på samma förslag.
  const fraga = await skapaFraga(db2, {
    tenantId: tenant,
    proposalId,
    fraga: "Vilka tre transaktioner ingick i kortavräkningen?",
    stalldAv: "konsult-e2e",
  });

  // Gult läge: 1 att attestera, 2 hos kunden.
  const gult = await manadsStatus(db2, tenant);
  assert.deepEqual(
    { gron: gult.gron, attest: gult.attest_vantar, komp: gult.kompletteringar_oppna },
    { gron: false, attest: 1, komp: 2 },
  );

  // 5. Svaren registreras — båda loggas som Rex-dokumentation vid förslaget.
  await registreraSvar(db2, {
    tenantId: tenant,
    kompletteringId: komplettering.id,
    svar: "Kvittot för 400 kr inkom via mejl.",
    registreratAv: "konsult-e2e",
  });
  await registreraSvar(db2, {
    tenantId: tenant,
    kompletteringId: fraga.id,
    svar: "Lunch, taxi och kontorsmaterial enligt specifikation.",
    registreratAv: "konsult-e2e",
  });
  const svar = await withTenant(db2, tenant, (tx) =>
    tx.query<{ payload: { proposalId: string } }>(
      `SELECT payload FROM audit_log WHERE event_type = 'kompletteringssvar'`,
    ),
  );
  assert.equal(svar.rows.filter((r) => r.payload.proposalId === proposalId).length, 2);

  // 6. Attest av förslaget → kön töms → månadschippet går till grönt.
  await decideProposal(db2, {
    tenantId: tenant,
    proposalId,
    outcome: "approved",
    decidedBy: "konsult-e2e",
  });
  const slut = await manadsStatus(db2, tenant);
  assert.deepEqual(
    { gron: slut.gron, attest: slut.attest_vantar, komp: slut.kompletteringar_oppna },
    { gron: true, attest: 0, komp: 0 },
  );
});
