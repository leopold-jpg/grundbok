import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { PgliteAuth, hashLosenord } from "../src/auth/pglite-auth";
import { kravKonsult, kravTenantIByra, tenantsForSession, SESSION_COOKIE } from "../src/auth/session";
import { attestKo, beslutsLogg } from "../src/ytor/byra";
import { bolagsoversikt } from "../src/ytor/operator";
import { handleProposal, decideProposal, type Principal } from "../src/lib/decisions";
import { exempelProposal } from "./helpers";

// WP15: gräns-smoke för ytorna. Byrå-mot-byrå-gränsen (URL-manipulation),
// operatörens innehålls-förbud och decided_by-identiteten testas på
// lib-nivå här; HTTP-lagret (redirects, 401/403 på riktiga URL:er) körs
// av scripts/e2e.py mot dev-servern.

const db = await createDb();
const auth = new PgliteAuth(db);

// En ANDRA byrå med eget klientbolag och egen konsult — seeden har bara
// Byrån Exempel AB, gränsen kräver två.
const byraB = await db.query<{ id: string }>(
  `INSERT INTO byraer (namn) VALUES ('Andra Byrån Exempel AB') RETURNING id`,
);
await db.query(
  `INSERT INTO tenants (id, namn, mall, byra_id) VALUES ('kund_c', 'Klient C Exempel AB', 'cafe', $1)`,
  [byraB.rows[0].id],
);
const konsultB = await db.query<{ id: string }>(
  `INSERT INTO users (email, name, password_hash, is_operator)
   VALUES ('konsult@andra-byran-exempel.se', 'Konsult Andra Exempel', $1, false)
   RETURNING id`,
  [hashLosenord("grundbok-dev")],
);
await db.query(`INSERT INTO memberships (user_id, byra_id) VALUES ($1, $2)`, [
  konsultB.rows[0].id,
  byraB.rows[0].id,
]);

const loginA = await auth.login("konsult.ett@byran-exempel.se", "grundbok-dev");
const sessionA = (await auth.session(loginA!.token))!;
const loginB = await auth.login("konsult@andra-byran-exempel.se", "grundbok-dev");
const sessionB = (await auth.session(loginB!.token))!;

// Ett pending-förslag hos vardera byrån.
const principal: Principal = {
  typ: "intern",
  tenant_id: "kund_a",
  module: "bokforing",
  scopes: ["proposals:write"],
  namn: "smoke",
};
const pA = exempelProposal();
const pC = exempelProposal({ tenant_id: "kund_c" });
assert.equal((await handleProposal(db, principal, pA)).status, "pending");
assert.equal(
  (await handleProposal(db, { ...principal, tenant_id: "kund_c" }, pC)).status,
  "pending",
);

test("byrå A ser aldrig byrå B: klientlista, kö och logg (URL-manipulation)", async () => {
  // Klientlistan kommer ur sessionen — kund_c finns inte i A:s värld.
  const klienterA = (await tenantsForSession(db, sessionA)).map((t) => t.id);
  assert.ok(!klienterA.includes("kund_c"));

  // URL-manipulation: A begär B:s klient explicit → vakten säger nej,
  // och ytlogiken ger tomt även om vakten skulle kringgås.
  assert.equal(await kravTenantIByra(db, sessionA, "kund_c"), false);
  assert.deepEqual(await attestKo(db, sessionA, "kund_c"), []);
  assert.deepEqual(await beslutsLogg(db, sessionA, "kund_c"), []);

  // "alla"-läget läcker inte heller: A:s kö saknar C:s förslag och tvärtom.
  const koA = await attestKo(db, sessionA, "alla");
  const koB = await attestKo(db, sessionB, "alla");
  assert.ok(koA.some((r) => r.id === pA.id) && !koA.some((r) => r.id === pC.id));
  assert.ok(koB.some((r) => r.id === pC.id) && !koB.some((r) => r.id === pA.id));
});

test("operatören nekas byråns värld men ser aggregat utan innehåll", async () => {
  const opLogin = await auth.login("leopold@otiva.se", "grundbok-dev");
  const opReq = new Request("http://localhost/api/byra/ko", {
    headers: { cookie: `${SESSION_COOKIE}=${opLogin!.token}` },
  });
  // Konsultkravet stoppar operatören — 403, inte en tom lista.
  const krav = await kravKonsult(db, opReq);
  assert.ok("http" in krav && krav.http === 403);

  // Operatörens egen vy: antal, aldrig summary/belopp/motpart.
  const oversikt = await bolagsoversikt(db);
  const kundC = oversikt.find((b) => b.tenant_id === "kund_c");
  assert.ok(kundC && kundC.forslag_7d >= 1);
  assert.ok(!("summary" in kundC!) && !("motpart" in kundC!) && !("belopp_ore" in kundC!));
  assert.ok(!JSON.stringify(oversikt).includes("Kaffebönor"));
});

test("decided_by är alltid ett riktigt user-id — attest utan session omöjlig", async () => {
  // Rutterna tar identiteten ur kravKonsult; utan session finns inget
  // user-id att besluta med (401 i auth.test.ts). Här: beslutet som
  // skrivs bär konsultens uuid, inte en fri sträng.
  await decideProposal(db, {
    tenantId: "kund_c",
    proposalId: pC.id,
    outcome: "approved",
    decidedBy: sessionB.user.id,
  });
  const d = await db.query<{ decided_by: string }>(
    `SELECT d.decided_by FROM decisions d WHERE d.proposal_id = $1`,
    [pC.id],
  );
  const user = await db.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [
    d.rows[0].decided_by,
  ]);
  assert.equal(user.rows[0]?.name, "Konsult Andra Exempel");

  // …och i byrå B:s logg är namnet uppslaget; byrå A:s logg saknar beslutet.
  const loggB = await beslutsLogg(db, sessionB, "alla");
  assert.ok(loggB.some((l) => l.proposal_id === pC.id && l.beslutad_av === "Konsult Andra Exempel"));
  const loggA = await beslutsLogg(db, sessionA, "alla");
  assert.ok(!loggA.some((l) => l.proposal_id === pC.id));
});
