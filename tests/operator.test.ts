import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { handleProposal, hamtaPolicy, type Principal } from "../src/lib/decisions";
import { verifieraAgentNyckel } from "../src/lib/agent-auth";
import {
  bolagsoversikt,
  listaMallar,
  sparaMall,
  provisioneraMedMall,
  roteraNyckel,
  halsa,
} from "../src/ytor/operator";
import { exempelProposal } from "./helpers";

// WP14: operatörskonsolens ytlogik — aggregat (aldrig innehåll),
// mallar, provisionering med mall och nyckelrotation som ETT flöde.

const db = await createDb();

test("bolagsoversikt: aggregat per bolag, aldrig förslags-innehåll", async () => {
  const principal: Principal = {
    typ: "intern",
    tenant_id: "kund_a",
    module: "bokforing",
    scopes: ["proposals:write"],
    namn: "test",
  };
  await handleProposal(db, principal, exempelProposal());

  const oversikt = await bolagsoversikt(db);
  const kundA = oversikt.find((b) => b.tenant_id === "kund_a");
  assert.ok(kundA);
  assert.equal(kundA!.byra, "Byrån Exempel AB");
  assert.ok(kundA!.forslag_7d >= 1);
  // Aggregat-regeln: raden innehåller antal, aldrig summary/belopp/motpart.
  for (const falt of ["summary", "belopp_ore", "motpart", "payload"]) {
    assert.ok(!(falt in kundA!), `${falt} får inte finnas i operatörens vy`);
  }
});

test("mallar: seedade startmallar finns; skapa + redigera", async () => {
  const mallar = await listaMallar(db);
  const bygg = mallar.find((m) => m.namn === "Bygg — försiktig");
  const rest = mallar.find((m) => m.namn === "Restaurang — standard");
  assert.ok(bygg && rest);
  assert.equal(bygg!.max_belopp_ore, 0);
  assert.deepEqual(rest!.tillatna_kinds, ["journal_entry"]);

  const { id } = await sparaMall(db, {
    namn: "Testmall",
    module: "bokforing",
    max_belopp_ore: 50_000,
    min_confidence: 0.9,
    kanda_motparter_endast: true,
    tillatna_kinds: ["journal_entry"],
  });
  await sparaMall(db, {
    id,
    namn: "Testmall",
    module: "bokforing",
    max_belopp_ore: 75_000,
    min_confidence: 0.9,
    kanda_motparter_endast: true,
    tillatna_kinds: ["journal_entry"],
  });
  const efter = (await listaMallar(db)).find((m) => m.id === id);
  assert.equal(efter!.max_belopp_ore, 75_000);
});

test("provisioneraMedMall: mallens värden kopieras till tenantens policy", async () => {
  const mallar = await listaMallar(db);
  const rest = mallar.find((m) => m.namn === "Restaurang — standard")!;

  const ny = await provisioneraMedMall(
    db,
    { tenantId: "kund_a", displayName: "kvittoagent-test", mallId: rest.id },
    "operator:test",
  );
  assert.equal(ny.module, "bokforing");
  assert.ok(ny.nyckel.startsWith("gk_"));

  const policy = await hamtaPolicy(db, "kund_a", "bokforing");
  assert.equal(policy!.max_belopp_ore, rest.max_belopp_ore);
  assert.equal(policy!.min_confidence, rest.min_confidence);
});

test("roteraNyckel: ETT flöde — ny nyckel gäller, gamla agenten avslutad", async () => {
  const forsta = await provisioneraMedMall(
    db,
    { tenantId: "kund_a", displayName: "rotationsagent", module: "bokforing" },
    "operator:test",
  );

  const roterad = await roteraNyckel(db, "kund_a", forsta.agent_id, "operator:test");
  assert.equal(roterad.ersatte, forsta.agent_id);
  assert.notEqual(roterad.nyckel, forsta.nyckel);

  // Gamla nyckeln är död (agenten canceled → inaktiv), nya lever.
  const gammal = await verifieraAgentNyckel(db, `Bearer ${forsta.nyckel}`);
  const ny = await verifieraAgentNyckel(db, `Bearer ${roterad.nyckel}`);
  assert.equal(gammal.typ, "inaktiv");
  assert.equal(ny.typ, "ok");

  // Konfigurationen följde med.
  const rad = await db.query<{ display_name: string; status: string }>(
    `SELECT display_name, status FROM agents WHERE id = $1`,
    [roterad.agent_id],
  );
  assert.equal(rad.rows[0].display_name, "rotationsagent");
  assert.equal(rad.rows[0].status, "active");

  // Rotation av redan avslutad agent nekas.
  await assert.rejects(
    () => roteraNyckel(db, "kund_a", forsta.agent_id, "operator:test"),
    /redan avslutad/,
  );
});

test("halsa: kö-djup och omförsök är siffror", async () => {
  const h = await halsa(db);
  assert.equal(typeof h.ko_djup, "number");
  assert.equal(typeof h.omforsok_24h, "number");
});
