import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { PgliteAuth, hashLosenord, verifieraLosenord } from "../src/auth/pglite-auth";
import {
  kravKonsult,
  kravOperator,
  kravTenantIByra,
  tenantsForSession,
  tokenUrCookieHeader,
  SESSION_COOKIE,
} from "../src/auth/session";

// WP11: auth och roller — grunden för de tre ytorna. Lokal PGlite-auth
// bakom AuthAdapter-interfacet (Supabase-bytet vid deploy är en adapter).

const db = await createDb();
const auth = new PgliteAuth(db);

function reqMedToken(token: string | null): Request {
  return new Request("http://localhost/test", {
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
  });
}

test("scrypt-hashning: verifierar rätt lösenord, avvisar fel", () => {
  const hash = hashLosenord("hemligt");
  assert.ok(verifieraLosenord("hemligt", hash));
  assert.ok(!verifieraLosenord("fel", hash));
  assert.ok(!verifieraLosenord("hemligt", "trasig-lagring"));
});

test("seed: byrån förvaltar kund_a och kund_b; konsulter + operator finns", async () => {
  const byra = await db.query<{ id: string }>(
    `SELECT id FROM byraer WHERE namn = 'Byrån Exempel AB'`,
  );
  assert.equal(byra.rows.length, 1);
  const tenants = await db.query<{ id: string }>(
    `SELECT id FROM tenants WHERE byra_id = $1 ORDER BY id`,
    [byra.rows[0].id],
  );
  assert.deepEqual(tenants.rows.map((t) => t.id), ["kund_a", "kund_b"]);
});

test("konsult loggar in → session med byrå-kontext; fel lösenord → null", async () => {
  assert.equal(await auth.login("konsult.ett@byran-exempel.se", "fel"), null);
  assert.equal(await auth.login("finns.inte@exempel.se", "grundbok-dev"), null);

  const inloggning = await auth.login("konsult.ett@byran-exempel.se", "grundbok-dev");
  assert.ok(inloggning);
  const session = await auth.session(inloggning!.token);
  assert.ok(session);
  assert.equal(session!.user.name, "Konsult Ett Exempel");
  assert.equal(session!.user.is_operator, false);
  assert.equal(session!.byra?.namn, "Byrån Exempel AB");
  assert.equal(session!.byra?.role, "konsult");
});

test("operatören har ingen byrå-kontext men operator-flaggan", async () => {
  const inloggning = await auth.login("leopold@otiva.se", "grundbok-dev");
  assert.ok(inloggning);
  const session = await auth.session(inloggning!.token);
  assert.equal(session!.user.is_operator, true);
  assert.equal(session!.byra, null);
});

test("logout dödar sessionen; okänd/trasig token → null", async () => {
  const inloggning = await auth.login("konsult.tva@byran-exempel.se", "grundbok-dev");
  assert.ok(await auth.session(inloggning!.token));
  await auth.logout(inloggning!.token);
  assert.equal(await auth.session(inloggning!.token), null);
  assert.equal(await auth.session("gs_finnsinte"), null);
  assert.equal(await auth.session("helt-trasig"), null);
});

test("kravKonsult: oinloggad → 401, operator utan byrå → 403, konsult → session", async () => {
  const utan = await kravKonsult(db, reqMedToken(null));
  assert.ok("http" in utan && utan.http === 401);

  const opLogin = await auth.login("leopold@otiva.se", "grundbok-dev");
  const somOperator = await kravKonsult(db, reqMedToken(opLogin!.token));
  assert.ok("http" in somOperator && somOperator.http === 403);

  const kLogin = await auth.login("konsult.ett@byran-exempel.se", "grundbok-dev");
  const somKonsult = await kravKonsult(db, reqMedToken(kLogin!.token));
  assert.ok("session" in somKonsult);
});

test("kravOperator: konsult → 403, operator → session", async () => {
  const kLogin = await auth.login("konsult.ett@byran-exempel.se", "grundbok-dev");
  const somKonsult = await kravOperator(db, reqMedToken(kLogin!.token));
  assert.ok("http" in somKonsult && somKonsult.http === 403);

  const opLogin = await auth.login("leopold@otiva.se", "grundbok-dev");
  const somOperator = await kravOperator(db, reqMedToken(opLogin!.token));
  assert.ok("session" in somOperator);
});

test("byrå-gränsen: tenantsForSession + kravTenantIByra", async () => {
  const kLogin = await auth.login("konsult.ett@byran-exempel.se", "grundbok-dev");
  const session = (await auth.session(kLogin!.token))!;

  const tenants = await tenantsForSession(db, session);
  assert.deepEqual(tenants.map((t) => t.id).sort(), ["kund_a", "kund_b"]);

  assert.equal(await kravTenantIByra(db, session, "kund_a"), true);
  assert.equal(await kravTenantIByra(db, session, "annan_byras_kund"), false);
});

test("cookie-parsning plockar rätt token ur headern", () => {
  assert.equal(tokenUrCookieHeader(`a=b; ${SESSION_COOKIE}=gs_abc123; c=d`), "gs_abc123");
  assert.equal(tokenUrCookieHeader(`${SESSION_COOKIE}=gs_x`), "gs_x");
  assert.equal(tokenUrCookieHeader("a=b"), null);
  assert.equal(tokenUrCookieHeader(null), null);
});
