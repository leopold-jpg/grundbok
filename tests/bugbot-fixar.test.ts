import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { withTenant } from "../src/lib/db/tenant";
import { PgliteAuth, hashLosenord } from "../src/auth/pglite-auth";
import { sakerNext } from "../src/auth/next-param";
import { verifieraAgentNyckel } from "../src/lib/agent-auth";
import {
  valideraBeslutsInput,
  dokumentHorTillKlient,
} from "../src/ytor/byra";
import { provisioneraMedMall, roteraNyckel } from "../src/ytor/operator";

// Bugbots sex fynd på PR #2 — ett test per fix.

const db = await createDb();

test("rotation är atomär: fel i avslutssteget → ingen ny agent, gamla nyckeln lever", async () => {
  const forsta = await provisioneraMedMall(
    db,
    { tenantId: "kund_a", displayName: "rotation-atomtest", module: "bokforing" },
    "operator:test",
  );

  // Simulera fel i avslutssteget: en trigger som vägrar just denna agents
  // canceled-övergång — motsvarar t.ex. ett tappat anslutningsfel mitt i.
  await db.exec(`
    CREATE OR REPLACE FUNCTION rotation_atomtest_fel() RETURNS trigger AS $$
    BEGIN
      IF NEW.status = 'canceled' AND OLD.display_name = 'rotation-atomtest' THEN
        RAISE EXCEPTION 'simulerat fel i avslutssteget';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER rotation_atomtest BEFORE UPDATE ON agents
      FOR EACH ROW EXECUTE FUNCTION rotation_atomtest_fel();
  `);

  await assert.rejects(
    () => roteraNyckel(db, "kund_a", forsta.agent_id, "operator:test"),
    /simulerat fel/,
  );

  // Allt rullades tillbaka: EN agent, fortfarande aktiv, nyckeln gäller.
  const kvar = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM agents WHERE display_name = 'rotation-atomtest'`,
  );
  assert.equal(kvar.rows.length, 1);
  assert.equal(kvar.rows[0].status, "active");
  const gammalNyckel = await verifieraAgentNyckel(db, `Bearer ${forsta.nyckel}`);
  assert.equal(gammalNyckel.typ, "ok");

  // Utan felet går rotationen igenom som förut — ETT flöde.
  await db.exec(`DROP TRIGGER rotation_atomtest ON agents`);
  const roterad = await roteraNyckel(db, "kund_a", forsta.agent_id, "operator:test");
  const efter = await db.query<{ status: string }>(
    `SELECT status FROM agents WHERE display_name = 'rotation-atomtest' ORDER BY created_at`,
  );
  assert.deepEqual(efter.rows.map((r) => r.status), ["canceled", "active"]);
  assert.equal((await verifieraAgentNyckel(db, `Bearer ${forsta.nyckel}`)).typ, "inaktiv");
  assert.equal((await verifieraAgentNyckel(db, `Bearer ${roterad.nyckel}`)).typ, "ok");
});

test("sakerNext: endast interna paths följs — //evil.com stoppas", () => {
  assert.equal(sakerNext("/byra"), "/byra");
  assert.equal(sakerNext("/byra?klient=kund_a"), "/byra?klient=kund_a");
  assert.equal(sakerNext("//evil.com"), null);
  assert.equal(sakerNext("//evil.com/byra"), null);
  assert.equal(sakerNext("/\\evil.com"), null);
  assert.equal(sakerNext("https://evil.com"), null);
  assert.equal(sakerNext("byra"), null);
  assert.equal(sakerNext(""), null);
  assert.equal(sakerNext(null), null);
  // Kontrolltecken-bypassen (fångad i adversariell granskning): WHATWG-
  // parsern strippar \t \n \r, så "/\t//evil.com" parsas till "//evil.com".
  // Valideringen går genom samma parser och ska stoppa alla varianter.
  assert.equal(sakerNext("/\t//evil.com"), null);
  assert.equal(sakerNext("/\n//evil.com"), null);
  assert.equal(sakerNext("/\r//evil.com"), null);
  assert.equal(sakerNext("/\t/evil.com"), null);
  // Redan URL-kodad %09 är en ofarlig path-segment (parsern avkodar den
  // inte), så den får följas oförändrad.
  assert.equal(sakerNext("/%09//evil.com"), "/%09//evil.com");
  // Interna paths med query/hash normaliseras men behålls.
  assert.equal(sakerNext("/byra#logg"), "/byra#logg");
});

test("multi-membership: äldsta byrån vinner, deterministiskt varje gång", async () => {
  // Två byråer där den ÄLDSTA membershipen tillhör byrån som sorterar
  // SIST på namn — träffas namnordning i stället för created_at faller testet.
  const byraSen = await db.query<{ id: string }>(
    `INSERT INTO byraer (namn) VALUES ('Aaa Byrå Exempel AB') RETURNING id`,
  );
  const byraTidig = await db.query<{ id: string }>(
    `INSERT INTO byraer (namn) VALUES ('Össby Byrå Exempel AB') RETURNING id`,
  );
  const anvandare = await db.query<{ id: string }>(
    `INSERT INTO users (email, name, password_hash, is_operator)
     VALUES ('tva.byraer@exempel.se', 'Konsult Multi Exempel', $1, false)
     RETURNING id`,
    [hashLosenord("grundbok-dev")],
  );
  await db.query(
    `INSERT INTO memberships (user_id, byra_id, created_at)
     VALUES ($1, $2, '2026-01-01'), ($1, $3, '2026-06-01')`,
    [anvandare.rows[0].id, byraTidig.rows[0].id, byraSen.rows[0].id],
  );

  const auth = new PgliteAuth(db);
  for (let i = 0; i < 5; i++) {
    const login = await auth.login("tva.byraer@exempel.se", "grundbok-dev");
    const session = await auth.session(login!.token);
    assert.equal(session!.byra?.namn, "Össby Byrå Exempel AB");
    await auth.logout(login!.token);
  }
});

test("valideraBeslutsInput: stavfel blir 400-fel, aldrig en avvisning", () => {
  assert.deepEqual(valideraBeslutsInput({ tenant_id: "kund_a", proposal_id: "p1", beslut: "godkand" }), {
    tenant_id: "kund_a",
    proposal_id: "p1",
    beslut: "godkand",
    reason: undefined,
  });
  assert.equal(
    (valideraBeslutsInput({ tenant_id: "kund_a", proposal_id: "p1", beslut: "avvisad", reason: "fel konto" }) as { beslut: string }).beslut,
    "avvisad",
  );
  // Stavfelet som tidigare loggades som permanent avvisning:
  assert.deepEqual(
    valideraBeslutsInput({ tenant_id: "kund_a", proposal_id: "p1", beslut: "godkänd" }),
    { fel: "beslut måste vara 'godkand' eller 'avvisad'" },
  );
  assert.deepEqual(
    valideraBeslutsInput({ tenant_id: "kund_a", proposal_id: "p1" }),
    { fel: "beslut måste vara 'godkand' eller 'avvisad'" },
  );
  assert.deepEqual(valideraBeslutsInput(null), { fel: "ogiltig JSON" });
  assert.deepEqual(valideraBeslutsInput({ proposal_id: "p1", beslut: "godkand" }), {
    fel: "tenant_id krävs",
  });
  assert.deepEqual(
    valideraBeslutsInput({ tenant_id: "kund_a", proposal_id: "p1", beslut: "avvisad", reason: 7 }),
    { fel: "motiveringen måste vara text" },
  );
});

test("dokumentHorTillKlient: en annan klients underlag är osynligt (RLS)", async () => {
  const dok = await withTenant(db, "kund_a", async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO documents (tenant_id, raw) VALUES ('kund_a', 'testunderlag') RETURNING id`,
    );
    return r.rows[0].id;
  });

  assert.equal(await dokumentHorTillKlient(db, "kund_a", dok), true);
  assert.equal(await dokumentHorTillKlient(db, "kund_b", dok), false);
  assert.equal(await dokumentHorTillKlient(db, "kund_a", "inte-en-uuid"), false);
  assert.equal(
    await dokumentHorTillKlient(db, "kund_a", "00000000-0000-4000-8000-0000000000ff"),
    false,
  );
});
