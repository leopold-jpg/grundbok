import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { withTenant } from "../src/lib/db/tenant";
import { skapaAgentNyckel } from "../src/lib/agent-auth";
import { decideProposal } from "../src/lib/decisions";
import { PgliteKo } from "../src/lib/queue";
import { körJobb } from "../src/workers/run-agent";
import {
  taEmotUnderlag,
  listaUnderlag,
  hamtaUnderlagDetalj,
  intakePort,
} from "../src/lib/intake";
import { skapaKlientInbjudan, losInKlientInbjudan } from "../src/auth/klient-inbjudan";
import { kaffefaktura } from "../src/lib/exempel";

// WP21: intake-porten — alla kanaler är dumma kurirer in till samma
// port (ADR-0002). Kedjan underlag → kö → befintlig worker →
// buildProposal → attestkö, härledd status, idempotens via content-hash
// och auth via klientsession ELLER agentnyckel med intake:write.

process.env.GRUNDBOK_FORCE_FALLBACK = "1";

const db = await createDb();
const ko = new PgliteKo(db);

// Aktiv bokföringsagent för kund_a — intakets jobb bär agentens identitet.
const agentA = await skapaAgentNyckel(db, {
  tenantId: "kund_a",
  module: "bokforing",
  scopes: ["proposals:write"],
  namn: "intake-worker-a",
});

// Klientanvändare i kund_a (WP20-flödet är förutsättningen).
const inbjudan = await skapaKlientInbjudan(db, {
  tenantId: "kund_a",
  email: "intake-klient@kund-a.se",
  skapadAv: "konsult:test",
});
const klient = await losInKlientInbjudan(db, {
  token: inbjudan.token,
  namn: "Intake Klient",
  losenord: "klientlosen-9",
});

function klientReq(body: unknown): Request {
  return new Request("http://test.local/api/intake", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `grundbok_session=${encodeURIComponent(klient.sessionToken)}`,
    },
    body: JSON.stringify(body),
  });
}

async function körAllaJobb(): Promise<void> {
  const meddelanden = await ko.read({ qty: 10, vtSeconds: 60 });
  for (const m of meddelanden) {
    await körJobb(db, m.message);
    await ko.archive(m.msg_id);
  }
}

test("kedjan: app-uppladdning → kö → worker → attestkö; status härleds mottaget→tolkat→bokfort", async () => {
  const utfall = await taEmotUnderlag(db, {
    tenantId: "kund_a",
    kalla: "app",
    inlamnadAv: "klient:test",
    innehall: { typ: "text", text: kaffefaktura("2026-07-08", 6) },
  });
  assert.equal(utfall.dubblett, false);
  assert.equal(utfall.jobb_koat, true);

  // Före workern: mottaget.
  let rader = await listaUnderlag(db, "kund_a");
  const rad = rader.find((r) => r.id === utfall.underlag_id);
  assert.equal(rad?.status, "mottaget");
  assert.equal(rad?.tolkat_at, null);

  // Workern kör — förslaget hamnar i attestkön (pending), status tolkat.
  await körAllaJobb();
  rader = await listaUnderlag(db, "kund_a");
  const tolkad = rader.find((r) => r.id === utfall.underlag_id);
  assert.equal(tolkad?.status, "tolkat");
  assert.ok(tolkad?.tolkat_at);
  assert.ok(tolkad?.motpart);

  // Konsulten attesterar → bokfört med verifikationsnummer.
  const proposal = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ id: string }>(
      `SELECT p.id FROM proposals p
       JOIN underlag u ON p.payload->'provenance'->'input_refs' ? ('document:' || u.document_id::text)
       WHERE u.id = $1`,
      [utfall.underlag_id],
    ),
  );
  await decideProposal(db, {
    tenantId: "kund_a",
    proposalId: proposal.rows[0].id,
    outcome: "approved",
    decidedBy: "konsult:test",
  });
  const bokford = (await listaUnderlag(db, "kund_a")).find(
    (r) => r.id === utfall.underlag_id,
  );
  assert.equal(bokford?.status, "bokfort");
  assert.ok(bokford?.bokfort_at);
  assert.ok((bokford?.verifikationsnummer ?? 0) > 0);
});

test("idempotens: samma innehåll två gånger → EN rad, notis, inget nytt jobb", async () => {
  const text = kaffefaktura("2026-03-15", 12);
  const forsta = await taEmotUnderlag(db, {
    tenantId: "kund_a",
    kalla: "app",
    inlamnadAv: "klient:test",
    innehall: { typ: "text", text },
  });
  const djupFore = await ko.depth();
  const andra = await taEmotUnderlag(db, {
    tenantId: "kund_a",
    kalla: "app",
    inlamnadAv: "klient:test",
    innehall: { typ: "text", text },
  });
  assert.equal(andra.dubblett, true);
  assert.equal(andra.underlag_id, forsta.underlag_id);
  assert.match(andra.notis ?? "", /redan inlämnat/);
  assert.equal(await ko.depth(), djupFore);

  const rader = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM underlag WHERE id = $1`,
      [forsta.underlag_id],
    ),
  );
  assert.equal(Number(rader.rows[0].n), 1);
  await körAllaJobb();
});

test("intakePort: klientsession → 201 med källa app; utan auth → 401", async () => {
  const svar = await intakePort(db, klientReq({ text: "Kvitto: Testbolaget AB\n2026-07-01\nSumma: 100,00 kr" }));
  assert.equal(svar.http, 201);
  const body = svar.body as { underlag_id: string };
  const rad = await hamtaUnderlagDetalj(db, "kund_a", body.underlag_id);
  assert.equal(rad?.kalla, "app");

  const utan = await intakePort(
    db,
    new Request("http://test.local/api/intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hej" }),
    }),
  );
  assert.equal(utan.http, 401);
});

test("intakePort: agentnyckel med intake:write → 201 källa api; utan scopet → 403", async () => {
  const kurir = await skapaAgentNyckel(db, {
    tenantId: "kund_a",
    module: "bokforing",
    scopes: ["intake:write"],
    namn: "openclaw-kurir",
  });
  const svar = await intakePort(
    db,
    new Request("http://test.local/api/intake", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${kurir.nyckel}`,
      },
      body: JSON.stringify({ text: "Faktura via API-kuriren\n2026-07-02\nSumma: 250,00 kr" }),
    }),
  );
  assert.equal(svar.http, 201);
  const rad = await hamtaUnderlagDetalj(
    db,
    "kund_a",
    (svar.body as { underlag_id: string }).underlag_id,
  );
  assert.equal(rad?.kalla, "api");

  // proposals:write-agenten (körvägen) saknar kurir-scopet → 403.
  const fel = await intakePort(
    db,
    new Request("http://test.local/api/intake", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentA.nyckel}`,
      },
      body: JSON.stringify({ text: "smyg" }),
    }),
  );
  assert.equal(fel.http, 403);
  assert.match(JSON.stringify(fel.body), /intake:write/);
  await körAllaJobb();
});

test("tenant-gränsen: kund_b ser aldrig kund_a:s underlag — id ger null (404)", async () => {
  const rader = await listaUnderlag(db, "kund_a");
  assert.ok(rader.length > 0);
  assert.equal(await hamtaUnderlagDetalj(db, "kund_b", rader[0].id), null);
  assert.deepEqual(await listaUnderlag(db, "kund_b"), []);
  // Trasigt id är lika osynligt — ingen skillnad som läcker existens.
  assert.equal(await hamtaUnderlagDetalj(db, "kund_b", "inte-ett-uuid"), null);
});

test("binärt underlag utan LLM: eskaleringsförslag i attestkön — aldrig kontering på gissning", async () => {
  // 1×1-pixel PNG.
  const pixel =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const utfall = await taEmotUnderlag(db, {
    tenantId: "kund_a",
    kalla: "app",
    inlamnadAv: "klient:test",
    innehall: { typ: "fil", base64: pixel, mime: "image/png", filnamn: "kvitto.png" },
  });
  assert.equal(utfall.jobb_koat, true);
  await körAllaJobb();

  const rad = await hamtaUnderlagDetalj(db, "kund_a", utfall.underlag_id);
  assert.equal(rad?.status, "tolkat");
  assert.match(rad?.summary ?? "", /ESKALERING/);

  // Eskaleringen är advisory_answer och ligger pending i attestkön.
  const p = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ kind: string; status: string }>(
      `SELECT kind, status FROM proposals p
       JOIN underlag u ON p.payload->'provenance'->'input_refs' ? ('document:' || u.document_id::text)
       WHERE u.id = $1`,
      [utfall.underlag_id],
    ),
  );
  assert.equal(p.rows[0].kind, "advisory_answer");
  assert.equal(p.rows[0].status, "pending");
});

test("portvalidering: fel filtyp 415, tom text 400, både text och fil 400", async () => {
  const feltyp = await intakePort(
    db,
    klientReq({ fil: { base64: "aGVq", mime: "application/zip" } }),
  );
  assert.equal(feltyp.http, 415);

  const tom = await intakePort(db, klientReq({ text: "   " }));
  assert.equal(tom.http, 400);

  const bada = await intakePort(
    db,
    klientReq({ text: "x", fil: { base64: "aGVq", mime: "image/png" } }),
  );
  assert.equal(bada.http, 400);
});
