import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import {
  provisionAgent,
  avslutaAgent,
  pausaAgent,
  ateruppta,
  listaAgenter,
} from "../src/lib/provisioning";
import { verifieraAgentNyckel } from "../src/lib/agent-auth";

// WP10: provisionering — "ny agent" är en databastransaktion, körbar
// från adminkonsolen idag och en Stripe-webhook imorgon (samma funktion,
// provisioned_by bär källan).

const db = await createDb();

test("provisionAgent: rad + nyckel + policy-länk i ett svep", async () => {
  const ny = await provisionAgent(
    db,
    {
      tenantId: "kund_a",
      module: "bokforing",
      displayName: "Bokföringsagent — Café Exempel AB",
      policy: {
        max_belopp_ore: 300_000,
        min_confidence: 0.85,
        kanda_motparter_endast: true,
        tillatna_kinds: ["journal_entry"],
      },
    },
    "konsult:konsult@byran.se",
  );
  assert.match(ny.nyckel, /^gk_/);

  const rad = await db.query<{
    display_name: string;
    policy_id: string | null;
    provisioned_by: string;
    status: string;
  }>(`SELECT display_name, policy_id, provisioned_by, status FROM agents WHERE id = $1`, [
    ny.agent_id,
  ]);
  assert.equal(rad.rows[0].display_name, "Bokföringsagent — Café Exempel AB");
  assert.ok(rad.rows[0].policy_id, "agenten ska länkas till modulens policyrad");
  assert.equal(rad.rows[0].provisioned_by, "konsult:konsult@byran.se");
  assert.equal(rad.rows[0].status, "active");

  // Policyn sattes i samma svep.
  const policy = await db.query<{ max_belopp_ore: string }>(
    `SELECT max_belopp_ore FROM autonomy_policies WHERE tenant_id = 'kund_a' AND module = 'bokforing'`,
  );
  assert.equal(Number(policy.rows[0].max_belopp_ore), 300_000);
});

test("stripe-vägen är samma kodväg: provisioned_by = stripe:<event_id>", async () => {
  const ny = await provisionAgent(
    db,
    { tenantId: "kund_b", module: "bokforing", displayName: "Self-service-agent" },
    "stripe:evt_e2e_123",
  );
  const rad = await db.query<{ provisioned_by: string }>(
    `SELECT provisioned_by FROM agents WHERE id = $1`,
    [ny.agent_id],
  );
  assert.equal(rad.rows[0].provisioned_by, "stripe:evt_e2e_123");
});

test("pausa → inaktiv i porten; återuppta → aktiv; avsluta → canceled + revoked_at", async () => {
  const ny = await provisionAgent(
    db,
    { tenantId: "kund_a", module: "bokforing", displayName: "livscykel-agent" },
    "konsult:test",
  );

  await pausaAgent(db, "kund_a", ny.agent_id);
  assert.equal((await verifieraAgentNyckel(db, `Bearer ${ny.nyckel}`)).typ, "inaktiv");

  await ateruppta(db, "kund_a", ny.agent_id);
  assert.equal((await verifieraAgentNyckel(db, `Bearer ${ny.nyckel}`)).typ, "ok");

  await avslutaAgent(db, "kund_a", ny.agent_id);
  const rad = await db.query<{ status: string; revoked_at: string | null }>(
    `SELECT status, revoked_at FROM agents WHERE id = $1`,
    [ny.agent_id],
  );
  assert.equal(rad.rows[0].status, "canceled");
  assert.ok(rad.rows[0].revoked_at, "avslut sätter revoked_at — raden raderas aldrig");
});

test("listan innehåller aldrig nyckel eller hash (smoke 4) och är tenant-scopad", async () => {
  await provisionAgent(
    db,
    { tenantId: "kund_a", module: "bokforing", displayName: "list-agent" },
    "konsult:test",
  );
  const lista = await listaAgenter(db, "kund_a");
  assert.ok(lista.length >= 1);
  for (const agent of lista) {
    const falt = Object.keys(agent);
    assert.ok(!falt.some((f) => /nyckel|key/i.test(f)), `fältläcka: ${falt.join(",")}`);
  }
  // kund_b ser inte kund_a:s agenter.
  const listaB = await listaAgenter(db, "kund_b");
  assert.ok(listaB.every((a) => a.namn !== "list-agent"));
});
