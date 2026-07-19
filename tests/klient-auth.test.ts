import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { PgliteAuth } from "../src/auth/pglite-auth";
import { kravKonsult, kravKlient, tenantsForSession } from "../src/auth/session";
import {
  skapaKlientInbjudan,
  hamtaKlientInbjudan,
  losInKlientInbjudan,
  listaKlientAnvandare,
} from "../src/auth/klient-inbjudan";
import { sha256Hex } from "../src/contracts";

// WP20: klientanvändaren — identiteten. Inbjudningsflödet, rollens
// gränser (aldrig byrå-kontext, aldrig andra tenants) och att en
// utgången/använd engångstoken är död.

const db = await createDb();
const auth = new PgliteAuth(db);

function reqMedCookie(token: string): Request {
  return new Request("http://test.local/api", {
    headers: { cookie: `grundbok_session=${encodeURIComponent(token)}` },
  });
}

test("inbjudan → inlösen → klientsession scopad till EN tenant, aldrig byrån", async () => {
  const inbjudan = await skapaKlientInbjudan(db, {
    tenantId: "kund_a",
    email: "Klient@Kund-A.se",
    skapadAv: "konsult:test",
  });
  assert.ok(inbjudan.token.startsWith("gi_"));

  // Valideringen (GET-vägen) exponerar bolag + normaliserad e-post.
  const giltig = await hamtaKlientInbjudan(db, inbjudan.token);
  assert.ok(giltig);
  assert.equal(giltig!.tenant_id, "kund_a");
  assert.equal(giltig!.email, "klient@kund-a.se");

  const inlost = await losInKlientInbjudan(db, {
    token: inbjudan.token,
    namn: "Klient Kund A",
    losenord: "klientlosen-1",
  });
  assert.equal(inlost.tenantId, "kund_a");

  // Sessionen bär klient-kontexten — och ALDRIG byrå-kontext, trots att
  // membershipet pekar på tenantens byrå.
  const session = await auth.session(inlost.sessionToken);
  assert.ok(session);
  assert.equal(session!.klient?.tenant_id, "kund_a");
  assert.equal(session!.byra, null);
  assert.equal(session!.user.is_operator, false);

  // kravKlient släpper in; kravKonsult (hela /byra) faller på 403.
  const klientKrav = await kravKlient(db, reqMedCookie(inlost.sessionToken));
  assert.ok("tenantId" in klientKrav && klientKrav.tenantId === "kund_a");
  const konsultKrav = await kravKonsult(db, reqMedCookie(inlost.sessionToken));
  assert.ok("http" in konsultKrav && konsultKrav.http === 403);

  // Byrå-scopade klientlistan är tom för en klientsession — vägen till
  // andra bolag finns inte ens som lista.
  assert.deepEqual(await tenantsForSession(db, session!), []);

  // Klienten kan logga in på vanligt vis med sitt satta lösenord.
  const login = await auth.login("klient@kund-a.se", "klientlosen-1");
  assert.ok(login);

  // Klientvyens läsning ser användaren och den konsumerade inbjudan.
  const kanal = await listaKlientAnvandare(db, "kund_a");
  assert.equal(kanal.anvandare.length, 1);
  assert.equal(kanal.anvandare[0].email, "klient@kund-a.se");
  assert.ok(kanal.inbjudningar.some((i) => i.anvand));
});

test("engångstoken: använd länk är död, utgången länk är död", async () => {
  // Använd (från förra testet skapas en ny här för isolation).
  const anvand = await skapaKlientInbjudan(db, {
    tenantId: "kund_a",
    email: "tvang@kund-a.se",
    skapadAv: "konsult:test",
  });
  await losInKlientInbjudan(db, {
    token: anvand.token,
    namn: "Två Gånger",
    losenord: "klientlosen-2",
  });
  assert.equal(await hamtaKlientInbjudan(db, anvand.token), null);
  await assert.rejects(
    losInKlientInbjudan(db, { token: anvand.token, namn: "Igen", losenord: "klientlosen-3" }),
    /ogiltig eller har gått ut/,
  );

  // Utgången: expires_at flyttas bakåt direkt i tabellen.
  const utgangen = await skapaKlientInbjudan(db, {
    tenantId: "kund_a",
    email: "sen@kund-a.se",
    skapadAv: "konsult:test",
  });
  await db.query(
    `UPDATE klient_inbjudningar SET expires_at = now() - interval '1 hour' WHERE token_hash = $1`,
    [sha256Hex(utgangen.token)],
  );
  assert.equal(await hamtaKlientInbjudan(db, utgangen.token), null);
  await assert.rejects(
    losInKlientInbjudan(db, { token: utgangen.token, namn: "Sen", losenord: "klientlosen-4" }),
    /ogiltig eller har gått ut/,
  );

  // Skräptoken och fel prefix är lika döda.
  assert.equal(await hamtaKlientInbjudan(db, "gi_finns-inte"), null);
  assert.equal(await hamtaKlientInbjudan(db, "gs_fel-prefix"), null);
});

test("befintlig e-post kan inte kapas via inbjudan; konsultsessionen är oförändrad", async () => {
  const inbjudan = await skapaKlientInbjudan(db, {
    tenantId: "kund_b",
    email: "konsult.ett@byran-exempel.se",
    skapadAv: "konsult:test",
  });
  await assert.rejects(
    losInKlientInbjudan(db, { token: inbjudan.token, namn: "Kapare", losenord: "klientlosen-5" }),
    /finns redan/,
  );

  // Konsulten är fortsatt konsult — session-mappningen påverkas inte.
  const login = await auth.login("konsult.ett@byran-exempel.se", "grundbok-dev");
  const session = await auth.session(login!.token);
  assert.ok(session!.byra);
  assert.equal(session!.klient, null);
});

test("ogiltig indata avvisas: e-post, lösenordslängd, tomt namn", async () => {
  await assert.rejects(
    skapaKlientInbjudan(db, { tenantId: "kund_a", email: "inte-en-adress", skapadAv: "k" }),
    /Ogiltig e-postadress/,
  );
  const inbjudan = await skapaKlientInbjudan(db, {
    tenantId: "kund_a",
    email: "kort@kund-a.se",
    skapadAv: "konsult:test",
  });
  await assert.rejects(
    losInKlientInbjudan(db, { token: inbjudan.token, namn: "Kort", losenord: "1234567" }),
    /minst 8 tecken/,
  );
  await assert.rejects(
    losInKlientInbjudan(db, { token: inbjudan.token, namn: "   ", losenord: "klientlosen-6" }),
    /Namn krävs/,
  );
  // Misslyckade försök har inte konsumerat token — giltig inlösen går igenom.
  const ok = await losInKlientInbjudan(db, {
    token: inbjudan.token,
    namn: "Kort Efternamn",
    losenord: "klientlosen-6",
  });
  assert.ok(ok.sessionToken.startsWith("gs_"));
});
