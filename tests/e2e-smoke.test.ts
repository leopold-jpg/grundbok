import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { provisionAgent, pausaAgent } from "../src/lib/provisioning";
import { proposalsPort } from "../src/lib/proposals-port";
import { mallRegistret } from "../src/mallar/registry";
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
