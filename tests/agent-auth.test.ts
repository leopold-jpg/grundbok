import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import {
  skapaAgentNyckel,
  verifieraAgentNyckel,
  revokeraAgentNyckel,
} from "../src/lib/agent-auth";
import { handleProposal } from "../src/lib/decisions";
import { exempelProposal } from "./helpers";

// WP4: scopade agentnycklar — gränsen där OpenClaw-agenter hos kund
// möter kärnan. Nyckeln ger rätten att FÖRESLÅ, aldrig att bokföra.

const db = await createDb();

test("skapad nyckel verifierar till rätt principal; hash lagras, aldrig klartext", async () => {
  const { id, nyckel } = await skapaAgentNyckel(db, {
    tenantId: "kund_a",
    module: "bokforing",
    scopes: ["proposals:write"],
    namn: "kvittoagent-hos-kund",
  });
  assert.match(nyckel, /^gk_/);

  const principal = await verifieraAgentNyckel(db, `Bearer ${nyckel}`);
  assert.ok(principal);
  assert.equal(principal!.typ, "agent_nyckel");
  assert.equal(principal!.tenant_id, "kund_a");
  assert.equal(principal!.module, "bokforing");
  assert.deepEqual(principal!.scopes, ["proposals:write"]);

  // Klartexten finns ingenstans i databasen.
  const rad = await db.query<{ key_hash: string }>(
    `SELECT key_hash FROM agent_keys WHERE id = $1`,
    [id],
  );
  assert.notEqual(rad.rows[0].key_hash, nyckel);
  assert.doesNotMatch(rad.rows[0].key_hash, /^gk_/);
});

test("okänd, trasig eller saknad nyckel → null", async () => {
  assert.equal(await verifieraAgentNyckel(db, "Bearer gk_finnsinte123"), null);
  assert.equal(await verifieraAgentNyckel(db, "Bearer helfel"), null);
  assert.equal(await verifieraAgentNyckel(db, null), null);
  assert.equal(await verifieraAgentNyckel(db, "Basic gk_x"), null);
});

test("revokerad nyckel slutar fungera omedelbart", async () => {
  const { id, nyckel } = await skapaAgentNyckel(db, {
    tenantId: "kund_a",
    module: "bokforing",
    scopes: ["proposals:write"],
    namn: "ska-revokeras",
  });
  assert.ok(await verifieraAgentNyckel(db, `Bearer ${nyckel}`));
  await revokeraAgentNyckel(db, "kund_a", id);
  assert.equal(await verifieraAgentNyckel(db, `Bearer ${nyckel}`), null);
});

test("nyckel utan proposals:write nekas i porten", async () => {
  const { nyckel } = await skapaAgentNyckel(db, {
    tenantId: "kund_a",
    module: "bokforing",
    scopes: ["ledger:read"],
    namn: "laesande-nyckel",
  });
  const principal = (await verifieraAgentNyckel(db, `Bearer ${nyckel}`))!;
  const r = await handleProposal(db, principal, exempelProposal());
  assert.equal(r.status, "avvisad_vid_porten");
  if (r.status !== "avvisad_vid_porten") return;
  assert.equal(r.http, 403);
  assert.ok(r.fel.some((f) => f.includes("proposals:write")));
});

test("tenant A:s nyckel kan inte skapa förslag för tenant B", async () => {
  const { nyckel } = await skapaAgentNyckel(db, {
    tenantId: "kund_a",
    module: "bokforing",
    scopes: ["proposals:write"],
    namn: "kund-a-agent",
  });
  const principal = (await verifieraAgentNyckel(db, `Bearer ${nyckel}`))!;
  const r = await handleProposal(db, principal, exempelProposal({ tenant_id: "kund_b" }));
  assert.equal(r.status, "avvisad_vid_porten");
  if (r.status !== "avvisad_vid_porten") return;
  assert.equal(r.http, 403);
});

test("nyckelns modul måste matcha förslagets modul", async () => {
  const { nyckel } = await skapaAgentNyckel(db, {
    tenantId: "kund_a",
    module: "bokforing",
    scopes: ["proposals:write"],
    namn: "bokforingsagent",
  });
  const principal = (await verifieraAgentNyckel(db, `Bearer ${nyckel}`))!;
  const r = await handleProposal(
    db,
    principal,
    exempelProposal({ module: "radgivning", kind: "advisory_answer", lines: [] }),
  );
  assert.equal(r.status, "avvisad_vid_porten");
  if (r.status !== "avvisad_vid_porten") return;
  assert.equal(r.http, 403);
});

test("giltig nyckel + giltigt förslag går igenom porten", async () => {
  const { nyckel } = await skapaAgentNyckel(db, {
    tenantId: "kund_a",
    module: "bokforing",
    scopes: ["proposals:write"],
    namn: "riktig-agent",
  });
  const principal = (await verifieraAgentNyckel(db, `Bearer ${nyckel}`))!;
  const r = await handleProposal(db, principal, exempelProposal());
  // Default-policyn auto-godkänner inget → kön.
  assert.equal(r.status, "pending");
});
