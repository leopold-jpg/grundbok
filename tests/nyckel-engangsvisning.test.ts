import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { sha256Hex } from "../src/contracts";
import { provisionAgent, listaAgenter } from "../src/lib/provisioning";
import { verifieraAgentNyckel } from "../src/lib/agent-auth";
import { flottoversikt, agentDetalj, roteraNyckel } from "../src/ytor/operator";
import { klientAgenter } from "../src/ytor/byra";

// Kompletteringspass (punkt 2): agentnyckeln visas exakt EN gång — i
// provisioneringens/rotationens returvärde — och går aldrig att hämta
// igen. Kärnan lagrar bara sha256-hashen (agent-auth.test.ts låser det);
// här låses att INGEN läsyta (operatörens lista, flottan, agentdetaljen,
// byråns klientvy) läcker vare sig klartext eller hash. Serialiserad
// yta granskas, inte enskilda fält — ett framtida tillagt fält som bär
// nyckeln faller också.

const db = await createDb();

/** Ytan får varken innehålla klartextnyckeln, dess hash eller ens
 *  fältnamn som antyder att nyckelmaterial följer med. */
function assertUtanNyckel(yta: unknown, nyckel: string, sammanhang: string) {
  const json = JSON.stringify(yta);
  assert.ok(!json.includes(nyckel), `${sammanhang}: klartextnyckeln läcker`);
  assert.ok(!json.includes(sha256Hex(nyckel)), `${sammanhang}: key_hash läcker`);
  assert.doesNotMatch(json, /key_hash|"nyckel"/, `${sammanhang}: nyckelfält läcker`);
}

test("nyckeln returneras en gång och finns sedan inte på någon läsyta", async () => {
  const ny = await provisionAgent(
    db,
    { tenantId: "kund_a", mall: "bokforing", displayName: "engångsvisning-test" },
    "operator:test",
  );
  assert.match(ny.nyckel, /^gk_/);

  // Samtliga läsytor som visar agenten: operatörens tenantlista, flottan,
  // agentdetaljen och byråns klientvy.
  const ytor: [string, unknown][] = [
    ["listaAgenter", await listaAgenter(db, "kund_a")],
    ["flottoversikt", await flottoversikt(db)],
    ["agentDetalj", await agentDetalj(db, ny.agent_id)],
    ["klientAgenter", await klientAgenter(db, "kund_a")],
  ];
  for (const [namn, yta] of ytor) {
    assert.ok(JSON.stringify(yta).includes(ny.agent_id), `${namn} ska visa agenten`);
    assertUtanNyckel(yta, ny.nyckel, namn);
  }
});

test("rotation: ny nyckel visas en gång, gamla dör, ingen yta läcker någon av dem", async () => {
  const forsta = await provisionAgent(
    db,
    { tenantId: "kund_a", mall: "bokforing", displayName: "rotations-engångstest" },
    "operator:test",
  );
  const roterad = await roteraNyckel(db, "kund_a", forsta.agent_id, "operator:test");
  assert.match(roterad.nyckel, /^gk_/);
  assert.notEqual(roterad.nyckel, forsta.nyckel);
  assert.equal(roterad.ersatte, forsta.agent_id);

  // Gamla nyckeln är död (agenten avslutad), nya verifierar.
  const gammal = await verifieraAgentNyckel(db, `Bearer ${forsta.nyckel}`);
  assert.equal(gammal.typ, "inaktiv");
  assert.equal((await verifieraAgentNyckel(db, `Bearer ${roterad.nyckel}`)).typ, "ok");

  for (const nyckel of [forsta.nyckel, roterad.nyckel]) {
    assertUtanNyckel(await listaAgenter(db, "kund_a"), nyckel, "listaAgenter efter rotation");
    assertUtanNyckel(await flottoversikt(db), nyckel, "flottoversikt efter rotation");
    assertUtanNyckel(
      await agentDetalj(db, roterad.agent_id),
      nyckel,
      "agentDetalj efter rotation",
    );
  }
});

test("databasen bär aldrig klartext: alla agentrader är hash-formade", async () => {
  const r = await db.query<{ key_hash: string }>(`SELECT key_hash FROM agents`);
  assert.ok(r.rows.length > 0);
  for (const rad of r.rows) {
    assert.match(rad.key_hash, /^[0-9a-f]{64}$/, "key_hash ska vara sha256-hex");
  }
});
