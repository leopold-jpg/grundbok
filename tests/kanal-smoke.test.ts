import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { withTenant } from "../src/lib/db/tenant";
import { PgliteAuth } from "../src/auth/pglite-auth";
import { skapaAgentNyckel } from "../src/lib/agent-auth";
import { decideProposal } from "../src/lib/decisions";
import { PgliteKo } from "../src/lib/queue";
import { körJobb } from "../src/workers/run-agent";
import { intakePort, listaUnderlag, hamtaUnderlagDetalj, taEmotUnderlag } from "../src/lib/intake";
import { taEmotInboundMejl } from "../src/lib/mejl/inbound";
import { laggTillAvsandare } from "../src/lib/mejl/avsandare";
import { svaraPaKundfraga, eskaleraKundfraga } from "../src/modules/kundassistent";
import { kundfragorForByra } from "../src/ytor/byra";
import { skapaKlientInbjudan, losInKlientInbjudan } from "../src/auth/klient-inbjudan";
import { kaffefaktura } from "../src/lib/exempel";

// WP25: gräns-smoke för HELA kanalen — permanenta regressionstester vid
// gränsen, körda som en extern part möter den. Varje test är en av
// kickoffens fem gränser; sist hela kedjan mejl → attest → bokfört
// sedd ur kundens app.

process.env.GRUNDBOK_FORCE_FALLBACK = "1";

const db = await createDb();
const ko = new PgliteKo(db);
const auth = new PgliteAuth(db);

await skapaAgentNyckel(db, {
  tenantId: "kund_a",
  module: "bokforing",
  scopes: ["proposals:write"],
  namn: "smoke-worker-a",
});

const inbjudanA = await skapaKlientInbjudan(db, {
  tenantId: "kund_a",
  email: "smoke-klient@kund-a.se",
  skapadAv: "konsult:test",
});
const klientA = await losInKlientInbjudan(db, {
  token: inbjudanA.token,
  namn: "Smoke Klient A",
  losenord: "klientlosen-25",
});

const konsultLogin = await auth.login("konsult.ett@byran-exempel.se", "grundbok-dev");
const konsultSession = (await auth.session(konsultLogin!.token))!;

async function körAllaJobb(): Promise<void> {
  const meddelanden = await ko.read({ qty: 10, vtSeconds: 60 });
  for (const m of meddelanden) {
    await körJobb(db, m.message);
    await ko.archive(m.msg_id);
  }
}

function intakeReq(body: unknown, cookie?: string): Request {
  return new Request("http://test.local/api/intake", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `grundbok_session=${encodeURIComponent(cookie)}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

test("1. mejl från oregistrerad avsändare → karantän — aldrig underlag, aldrig förslag", async () => {
  const utfall = await taEmotInboundMejl(db, {
    till: ["kvitto+kund_a@inbound.grundbok.example"],
    fran: "angripare@extern.se",
    amne: "Faktura",
    text: kaffefaktura("2026-07-11", 6),
    bilagor: [],
  });
  assert.equal(utfall.status, "karantan");

  // Även efter en worker-runda finns inget förslag ur brevet.
  await körAllaJobb();
  const r = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ underlag: string; forslag: string }>(
      `SELECT
         (SELECT count(*) FROM underlag WHERE kalla = 'mejl') AS underlag,
         (SELECT count(*) FROM proposals) AS forslag`,
    ),
  );
  assert.equal(Number(r.rows[0].underlag), 0);
  assert.equal(Number(r.rows[0].forslag), 0);
});

test("2. klienten ser bara egen historik; annan tenants underlag-id → 404-semantik", async () => {
  const egen = await taEmotUnderlag(db, {
    tenantId: "kund_a",
    kalla: "app",
    inlamnadAv: "klient:smoke",
    innehall: { typ: "text", text: "Kvitto: Egna Bolaget AB\n2026-07-12\nSumma: 50,00 kr" },
  });
  const frammande = await taEmotUnderlag(db, {
    tenantId: "kund_b",
    kalla: "app",
    inlamnadAv: "klient:smoke",
    innehall: { typ: "text", text: "Kvitto: Andras Bolag AB\n2026-07-12\nSumma: 75,00 kr" },
  });

  const historik = await listaUnderlag(db, "kund_a");
  assert.ok(historik.some((u) => u.id === egen.underlag_id));
  assert.ok(!historik.some((u) => u.id === frammande.underlag_id));

  // Annan tenants id ur kund_a:s session: null (routen svarar 404) —
  // exakt samma utfall som ett påhittat id: existensen läcker inte.
  assert.equal(await hamtaUnderlagDetalj(db, "kund_a", frammande.underlag_id), null);
  assert.equal(
    await hamtaUnderlagDetalj(db, "kund_a", "00000000-0000-4000-8000-000000000042"),
    null,
  );
});

test("3. dubbel uppladdning → EN rad — även när samma innehåll kommer via TVÅ kanaler", async () => {
  const text = kaffefaktura("2026-05-02", 12);
  const viaApp = await intakePort(db, intakeReq({ text }, klientA.sessionToken));
  assert.equal(viaApp.http, 201);

  // Samma innehåll via mejl (registrerad avsändare): dubblett, en rad.
  await laggTillAvsandare(db, {
    tenantId: "kund_a",
    email: "smoke@kund-a.se",
    registreradAv: "klient:smoke",
  });
  const viaMejl = await taEmotInboundMejl(db, {
    till: ["kvitto+kund_a@inbound.grundbok.example"],
    fran: "smoke@kund-a.se",
    amne: "Samma faktura igen",
    text,
    bilagor: [],
  });
  assert.equal(viaMejl.status, "mottaget");
  assert.ok(viaMejl.status === "mottaget" && viaMejl.underlag[0].dubblett);

  const antal = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM underlag WHERE content_hash = (
       SELECT content_hash FROM underlag WHERE id = $1
     )`, [(viaApp.body as { underlag_id: string }).underlag_id]),
  );
  assert.equal(Number(antal.rows[0].n), 1);

  // Och aldrig dubbla förslag: en worker-runda ger exakt ett förslag
  // för dokumentet (kön fick ett jobb, inte två).
  await körAllaJobb();
  const forslag = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM proposals p
       JOIN underlag u ON p.payload->'provenance'->'input_refs' ? ('document:' || u.document_id::text)
       WHERE u.id = $1`,
      [(viaApp.body as { underlag_id: string }).underlag_id],
    ),
  );
  assert.equal(Number(forslag.rows[0].n), 1);
});

test("4. intake utan giltig auth → 401; konsultsession är inte klientsession → 403", async () => {
  const utan = await intakePort(db, intakeReq({ text: "smyg" }));
  assert.equal(utan.http, 401);

  // Konsulten har session men ingen klientroll — 403, aldrig en väg in.
  const konsult = await intakePort(db, intakeReq({ text: "smyg" }, konsultLogin!.token));
  assert.equal(konsult.http, 403);

  // Payloadens egen utsaga om tenant ignoreras — porten scopas ur
  // principalen (klient A landar i A oavsett vad kroppen påstår).
  const spoof = await intakePort(
    db,
    intakeReq({ text: "Kvitto: Spoof AB\n2026-07-13\nSumma: 1,00 kr", tenant_id: "kund_b" }, klientA.sessionToken),
  );
  assert.equal(spoof.http, 201);
  const rad = await hamtaUnderlagDetalj(
    db,
    "kund_a",
    (spoof.body as { underlag_id: string }).underlag_id,
  );
  assert.ok(rad);
  assert.equal(await hamtaUnderlagDetalj(db, "kund_b", rad!.id), null);
});

test("5. kundassistenten vägrar råd + erbjuder eskalering; ärendet syns i byråns kö", async () => {
  const svar = await svaraPaKundfraga(db, {
    tenantId: "kund_a",
    fraga: "Får jag dra av momsen på leasingbilen?",
    stalldAv: "klient:smoke",
  });
  assert.equal(svar.typ, "radgivning_avbojd");
  assert.equal(svar.erbjud_eskalering, true);

  const arende = await eskaleraKundfraga(db, {
    tenantId: "kund_a",
    fraga: "Får jag dra av momsen på leasingbilen?",
    stalldAv: "klient:smoke",
  });

  const byransKo = await kundfragorForByra(db, konsultSession, "alla");
  const iKon = byransKo.find((f) => f.id === arende.id);
  assert.ok(iKon, "eskaleringen ska synas i byråns kö");
  assert.equal(iKon!.status, "open");
  assert.equal(iKon!.tenant_namn, "Café Exempel AB");
});

test("hela kanalen: mejl in → worker → attest → bokfört, sett ur kundens app", async () => {
  const utfall = await taEmotInboundMejl(db, {
    till: ["kvitto+kund_a@inbound.grundbok.example"],
    fran: "smoke@kund-a.se",
    amne: "VB: kaffefaktura juni",
    text: kaffefaktura("2026-06-10", 6),
    bilagor: [],
  });
  assert.equal(utfall.status, "mottaget");
  const underlagId = utfall.status === "mottaget" ? utfall.underlag[0].underlag_id : "";

  await körAllaJobb();
  const tolkad = await hamtaUnderlagDetalj(db, "kund_a", underlagId);
  assert.equal(tolkad?.status, "tolkat");
  assert.equal(tolkad?.kalla, "mejl");

  const proposal = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ id: string }>(
      `SELECT p.id FROM proposals p
       JOIN underlag u ON p.payload->'provenance'->'input_refs' ? ('document:' || u.document_id::text)
       WHERE u.id = $1`,
      [underlagId],
    ),
  );
  await decideProposal(db, {
    tenantId: "kund_a",
    proposalId: proposal.rows[0].id,
    outcome: "approved",
    decidedBy: konsultSession.user.id,
  });

  const bokford = await hamtaUnderlagDetalj(db, "kund_a", underlagId);
  assert.equal(bokford?.status, "bokfort");
  assert.ok((bokford?.verifikationsnummer ?? 0) > 0);

  // Kundassistenten ser samma sanning: statusfrågan räknar det bokförda.
  const status = await svaraPaKundfraga(db, {
    tenantId: "kund_a",
    fraga: "Har ni fått min faktura?",
    stalldAv: "klient:smoke",
  });
  assert.match(status.svar, /1 bokförda/);
});
