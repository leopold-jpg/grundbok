import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { withTenant } from "../src/lib/db/tenant";
import { provisionAgent, pausaAgent, avslutaAgent, listaAgenter } from "../src/lib/provisioning";
import { proposalsPort } from "../src/lib/proposals-port";
import { körJobb } from "../src/workers/run-agent";
import { uuidv5 } from "../src/lib/uuid5";
import { kaffefaktura } from "../src/lib/exempel";
import { exempelProposal } from "./helpers";
import type { AgentJobb } from "../src/lib/queue";

// Smoke-tester för runtime-gränsen (kickoff-tillägget, utökar WP7).
// ADR-0003: delad runtime ⇒ tenant-isoleringen vilar helt på RLS +
// nyckelscopes — dessa är permanenta regressionstester, körda vid
// gränsen precis som en extern agent/worker möter den.
process.env.GRUNDBOK_FORCE_FALLBACK = "1";

const db = await createDb();

test("1. paused/canceled agent → 403 på POST /api/proposals", async () => {
  const ny = await provisionAgent(
    db,
    { tenantId: "kund_a", module: "bokforing", displayName: "smoke-pausad" },
    "konsult:test",
  );

  await pausaAgent(db, "kund_a", ny.agent_id);
  const pausad = await proposalsPort(db, `Bearer ${ny.nyckel}`, exempelProposal());
  assert.equal(pausad.http, 403);
  assert.match(JSON.stringify(pausad.body), /pausad/);

  await avslutaAgent(db, "kund_a", ny.agent_id);
  const avslutad = await proposalsPort(db, `Bearer ${ny.nyckel}`, exempelProposal());
  assert.equal(avslutad.http, 403);
  assert.match(JSON.stringify(avslutad.body), /avslutad/);

  // Okänd nyckel är fortsatt 401 — skillnaden är medveten.
  const okand = await proposalsPort(db, "Bearer gk_okand", exempelProposal());
  assert.equal(okand.http, 401);
});

test("2. samma job kört två gånger → exakt en proposal", async () => {
  const ny = await provisionAgent(
    db,
    { tenantId: "kund_a", module: "bokforing", displayName: "smoke-idempotens" },
    "konsult:test",
  );
  const doc = await withTenant(db, "kund_a", async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO documents (tenant_id, raw) VALUES ('kund_a', $1) RETURNING id`,
      [kaffefaktura("2026-07-08", 6)],
    );
    return r.rows[0].id;
  });
  const jobb: AgentJobb = {
    job_id: "smoke-jobb-1",
    tenant_id: "kund_a",
    agent_id: ny.agent_id,
    module: "bokforing",
    trigger: "smoke",
    payload_ref: `document:${doc}`,
  };

  const forsta = await körJobb(db, jobb);
  assert.equal(forsta.utfall, "klar");
  const andra = await körJobb(db, jobb);
  assert.equal(andra.utfall, "duplicate");

  const antal = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM proposals WHERE id = $1`, [
      uuidv5(jobb.job_id),
    ]),
  );
  assert.equal(Number(antal.rows[0].n), 1);
});

test("3. tenant A:s jobb kan inte referera tenant B:s agent", async () => {
  const agentB = await provisionAgent(
    db,
    { tenantId: "kund_b", module: "bokforing", displayName: "smoke-b-agent" },
    "konsult:test",
  );
  const doc = await withTenant(db, "kund_a", async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO documents (tenant_id, raw) VALUES ('kund_a', 'x') RETURNING id`,
    );
    return r.rows[0].id;
  });
  const jobb: AgentJobb = {
    job_id: "smoke-jobb-cross",
    tenant_id: "kund_a",
    agent_id: agentB.agent_id,
    module: "bokforing",
    trigger: "smoke",
    payload_ref: `document:${doc}`,
  };

  const utfall = await körJobb(db, jobb);
  assert.equal(utfall.utfall, "fel");
  if (utfall.utfall === "fel") assert.match(utfall.detalj, /tenant-mismatch/);
  const spar = await withTenant(db, "kund_a", (tx) =>
    tx.query(`SELECT 1 FROM proposals WHERE id = $1`, [uuidv5(jobb.job_id)]),
  );
  assert.equal(spar.rows.length, 0);
});

test("4. nyckeln returneras aldrig i någon läs-yta (endast hash lagras)", async () => {
  const ny = await provisionAgent(
    db,
    { tenantId: "kund_a", module: "bokforing", displayName: "smoke-lasyta" },
    "konsult:test",
  );

  // Läslistan: inga nyckel-/hash-fält.
  const lista = await listaAgenter(db, "kund_a");
  for (const agent of lista) {
    const serialiserad = JSON.stringify(agent);
    assert.ok(!serialiserad.includes(ny.nyckel), "klartextnyckeln får aldrig läcka");
    assert.ok(
      !Object.keys(agent).some((f) => /nyckel|key|hash/i.test(f)),
      `fältläcka i läs-ytan: ${Object.keys(agent).join(",")}`,
    );
  }

  // Databasen har enbart hashen.
  const rad = await db.query<{ key_hash: string }>(
    `SELECT key_hash FROM agents WHERE id = $1`,
    [ny.agent_id],
  );
  assert.notEqual(rad.rows[0].key_hash, ny.nyckel);

  // App-rollen (RLS-läsning) kommer åt raden men kan aldrig ändra den —
  // skrivning är service-vägens ensamrätt.
  await assert.rejects(
    withTenant(db, "kund_a", (tx) =>
      tx.query(`UPDATE agents SET status = 'canceled' WHERE id = $1`, [ny.agent_id]),
    ),
    /permission denied/,
  );
});
