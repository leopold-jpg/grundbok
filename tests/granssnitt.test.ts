import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { withTenant } from "../src/lib/db/tenant";
import { skapaAgentNyckel, verifieraAgentNyckel } from "../src/lib/agent-auth";
import { handleProposal, sparaPolicy } from "../src/lib/decisions";
import { exempelProposal } from "./helpers";
import { sha256Hex } from "../src/contracts";
import type { Principal } from "../src/lib/decisions";

// WP7: smoke-tester för GRÄNSEN — de fyra scenarierna ur kickoffen,
// körda som en extern agent skulle möta dem: äkta nyckel → principal →
// porten. Kompletterar de djupare enhetstesterna i agent-auth/beslutsmotor.

const db = await createDb();

async function agentPrincipal(
  tenantId: string,
  scopes: ("proposals:write" | "ledger:read")[] = ["proposals:write"],
): Promise<Principal> {
  const { nyckel } = await skapaAgentNyckel(db, {
    tenantId,
    module: "bokforing",
    scopes,
    namn: `smoke-${tenantId}-${scopes.join("+")}`,
  });
  const utfall = await verifieraAgentNyckel(db, `Bearer ${nyckel}`);
  assert.equal(utfall.typ, "ok", "nyckeln ska verifiera");
  if (utfall.typ !== "ok") throw new Error("förväntade ok");
  return utfall.principal;
}

test("1. agentnyckel utan rätt scope nekas", async () => {
  const principal = await agentPrincipal("kund_a", ["ledger:read"]);
  const r = await handleProposal(db, principal, exempelProposal());
  assert.equal(r.status, "avvisad_vid_porten");
  if (r.status === "avvisad_vid_porten") assert.equal(r.http, 403);
});

test("2. proposal med manipulerad hash nekas — och lämnar inga spår", async () => {
  const principal = await agentPrincipal("kund_a");
  const p = exempelProposal();
  const manipulerad = {
    ...p,
    lines: p.lines.map((l, i) => (i === 0 ? { ...l, debet_ore: 1, kredit_ore: 0 } : l)),
    // hash lämnas kvar från originalet → payload ≠ hash
  };
  const r = await handleProposal(db, principal, manipulerad);
  assert.equal(r.status, "avvisad_vid_porten");
  const spar = await withTenant(db, "kund_a", (tx) =>
    tx.query(`SELECT 1 FROM proposals WHERE id = $1`, [p.id]),
  );
  assert.equal(spar.rows.length, 0);
});

test("3. auto_approve respekterar max_belopp och correction-undantaget", async () => {
  const principal = await agentPrincipal("kund_a");
  await sparaPolicy(db, {
    tenant_id: "kund_a",
    module: "bokforing",
    max_belopp_ore: 200_000, // 2 000 kr
    min_confidence: 0.5,
    kanda_motparter_endast: false,
    tillatna_kinds: ["journal_entry", "correction"],
  });

  // Under beloppsgränsen → auto + bokfört.
  const liten = exempelProposal();
  const r1 = await handleProposal(db, principal, liten);
  assert.equal(r1.status, "auto_approved");
  if (r1.status !== "auto_approved") return;
  assert.ok(r1.verifikation);

  // Över beloppsgränsen → kön.
  const stor = exempelProposal({
    lines: [
      { konto: "4010", benamning: "Stort inköp", debet_ore: 300_000, kredit_ore: 0 },
      { konto: "2440", benamning: "Leverantörsskulder", debet_ore: 0, kredit_ore: 300_000 },
    ],
  });
  const r2 = await handleProposal(db, principal, stor);
  assert.equal(r2.status, "pending");

  // Correction under gränsen och i tillåtna kinds → ändå ALDRIG auto.
  const rattelse = exempelProposal({
    kind: "correction",
    lines: [
      { konto: "2440", benamning: "Leverantörsskulder", debet_ore: 106_000, kredit_ore: 0 },
      { konto: "4010", benamning: "Inköp material och varor", debet_ore: 0, kredit_ore: 100_000 },
      { konto: "2641", benamning: "Debiterad ingående moms", debet_ore: 0, kredit_ore: 6_000 },
    ],
    provenance: {
      model: "claude-opus-4-8",
      prompt_hash: sha256Hex("smoke"),
      module_version: "0.2.0",
      input_refs: [`verification:${r1.verifikation!.id}`],
      injection_screened: true,
    },
  });
  const r3 = await handleProposal(db, principal, rattelse);
  assert.equal(r3.status, "pending");
  if (r3.status === "pending") {
    assert.ok(r3.missade_villkor.some((v) => v.includes("correction")));
  }
});

test("4. tenant A:s nyckel kan inte skapa förslag för tenant B", async () => {
  const principal = await agentPrincipal("kund_a");
  const r = await handleProposal(db, principal, exempelProposal({ tenant_id: "kund_b" }));
  assert.equal(r.status, "avvisad_vid_porten");
  if (r.status !== "avvisad_vid_porten") return;
  assert.equal(r.http, 403);
  // Och ingenting hamnade hos kund_b.
  const hosB = await withTenant(db, "kund_b", (tx) =>
    tx.query(`SELECT 1 FROM proposals`),
  );
  assert.equal(hosB.rows.length, 0);
});
