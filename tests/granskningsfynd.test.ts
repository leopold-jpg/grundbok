import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb, migrate } from "../src/lib/db/client";
import { withTenant } from "../src/lib/db/tenant";
import { skapaAgentNyckel } from "../src/lib/agent-auth";
import { decideProposal } from "../src/lib/decisions";
import { PgliteKo } from "../src/lib/queue";
import { körJobb } from "../src/workers/run-agent";
import {
  taEmotUnderlag,
  hamtaUnderlagDetalj,
  lagesSiffror,
  intakePort,
} from "../src/lib/intake";
import { webhookHemlighetOk, taEmotInboundMejl } from "../src/lib/mejl/inbound";
import { laggTillAvsandare } from "../src/lib/mejl/avsandare";
import { svaraPaKundfraga } from "../src/modules/kundassistent";
import { skapaKlientInbjudan, losInKlientInbjudan } from "../src/auth/klient-inbjudan";
import { kaffefaktura } from "../src/lib/exempel";

// Adversariella granskningens bekräftade fynd som regressionstester:
// strandade underlag läks, statusen ljuger aldrig (hanterad ≠ bokfört ≠
// väntar), webhooken är fail-closed i produktion, hoppade bilagor
// lämnar spår, storleksgränsen håller och RLS-skrivvakten biter.

process.env.GRUNDBOK_FORCE_FALLBACK = "1";

const db = await createDb();
const ko = new PgliteKo(db);

async function körAllaJobb(): Promise<void> {
  const meddelanden = await ko.read({ qty: 10, vtSeconds: 60 });
  for (const m of meddelanden) {
    await körJobb(db, m.message);
    await ko.archive(m.msg_id);
  }
}

async function forslagsIdForUnderlag(tenantId: string, underlagId: string): Promise<string> {
  const r = await withTenant(db, tenantId, (tx) =>
    tx.query<{ id: string }>(
      `SELECT p.id FROM proposals p
       JOIN underlag u ON p.payload->'provenance'->'input_refs' ? ('document:' || u.document_id::text)
       WHERE u.id = $1`,
      [underlagId],
    ),
  );
  return r.rows[0].id;
}

test("strandat underlag läks: uppladdning utan agent → aktivering → omsändning köar om idempotent", async () => {
  const text = kaffefaktura("2026-07-14", 6);

  // Ingen aktiv agent: underlaget skapas, inget jobb, ärlig notis.
  const forsta = await taEmotUnderlag(db, {
    tenantId: "kund_a",
    kalla: "app",
    inlamnadAv: "klient:test",
    innehall: { typ: "text", text },
  });
  assert.equal(forsta.jobb_koat, false);
  assert.match(forsta.notis ?? "", /aktiverat bokföringen/);

  // Omsändning FÖRE aktivering: fortfarande ärlig — inget jobb att köa.
  const fore = await taEmotUnderlag(db, {
    tenantId: "kund_a",
    kalla: "app",
    inlamnadAv: "klient:test",
    innehall: { typ: "text", text },
  });
  assert.equal(fore.dubblett, true);
  assert.equal(fore.jobb_koat, false);
  assert.match(fore.notis ?? "", /aktiverat bokföringen/);

  // Byrån aktiverar agenten; kunden skickar samma kvitto igen →
  // läkningsvägen köar om (deterministiskt job_id → idempotent).
  await skapaAgentNyckel(db, {
    tenantId: "kund_a",
    module: "bokforing",
    scopes: ["proposals:write"],
    namn: "laknings-agent",
  });
  const efter = await taEmotUnderlag(db, {
    tenantId: "kund_a",
    kalla: "app",
    inlamnadAv: "klient:test",
    innehall: { typ: "text", text },
  });
  assert.equal(efter.dubblett, true);
  assert.equal(efter.jobb_koat, true);
  assert.match(efter.notis ?? "", /startat om/);

  // Ytterligare en omsändning medan jobbet lever: köas INTE dubbelt.
  const under = await taEmotUnderlag(db, {
    tenantId: "kund_a",
    kalla: "app",
    inlamnadAv: "klient:test",
    innehall: { typ: "text", text },
  });
  assert.equal(under.jobb_koat, false);
  assert.match(under.notis ?? "", /pågår/);
  assert.equal(await ko.depth(), 1);

  await körAllaJobb();
  const rad = await hamtaUnderlagDetalj(db, "kund_a", forsta.underlag_id);
  assert.equal(rad?.status, "tolkat");

  // Efter att förslaget finns: omsändning är en ren dubblett igen.
  const klart = await taEmotUnderlag(db, {
    tenantId: "kund_a",
    kalla: "app",
    inlamnadAv: "klient:test",
    innehall: { typ: "text", text },
  });
  assert.equal(klart.jobb_koat, false);
  assert.match(klart.notis ?? "", /behandlas bara en gång/);
});

test("avvisat förslag → status 'hanterad', räknas aldrig som väntande, assistenten säger det", async () => {
  const utfall = await taEmotUnderlag(db, {
    tenantId: "kund_a",
    kalla: "app",
    inlamnadAv: "klient:test",
    innehall: { typ: "text", text: "Kvitto: Privata Notan AB\n2026-07-15\nSumma: 900,00 kr" },
  });
  await körAllaJobb();
  await decideProposal(db, {
    tenantId: "kund_a",
    proposalId: await forslagsIdForUnderlag("kund_a", utfall.underlag_id),
    outcome: "rejected",
    decidedBy: "konsult:test",
    reason: "privat kostnad",
  });

  const rad = await hamtaUnderlagDetalj(db, "kund_a", utfall.underlag_id);
  assert.equal(rad?.status, "hanterad");
  assert.equal(rad?.bokfort_at, null);
  assert.equal(rad?.verifikationsnummer, null);

  // Läget: det hanterade underlaget räknas INTE som väntande.
  const laget = await lagesSiffror(db, "kund_a");
  const vantande = (await withTenant(db, "kund_a", (tx) =>
    tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM underlag`),
  )).rows[0];
  assert.ok(laget.vantar < Number(vantande.n));

  // Assistenten: hanterade redovisas separat — aldrig "väntar hos byrån".
  const status = await svaraPaKundfraga(db, {
    tenantId: "kund_a",
    fraga: "Hur går det med mina kvitton?",
    stalldAv: "klient:test",
  });
  assert.match(status.svar, /1 har byrån hanterat utan bokföring/);
});

test("attesterad eskalering (advisory) → 'hanterad' — ALDRIG en falsk Bokfört-stämpel", async () => {
  const pixel =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const utfall = await taEmotUnderlag(db, {
    tenantId: "kund_a",
    kalla: "app",
    inlamnadAv: "klient:test",
    innehall: { typ: "fil", base64: pixel, mime: "image/png", filnamn: "foto.png" },
  });
  await körAllaJobb();

  // Konsulten kvitterar eskaleringen (advisory_answer → ingen ledger-effekt).
  const beslut = await decideProposal(db, {
    tenantId: "kund_a",
    proposalId: await forslagsIdForUnderlag("kund_a", utfall.underlag_id),
    outcome: "approved",
    decidedBy: "konsult:test",
  });
  assert.equal(beslut.outcome, "approved");
  assert.equal("verifikation" in beslut ? beslut.verifikation : null, null);

  const rad = await hamtaUnderlagDetalj(db, "kund_a", utfall.underlag_id);
  assert.equal(rad?.status, "hanterad");
  assert.equal(rad?.verifikationsnummer, null);
});

test("lagesSiffror: bokfört underlag ger senast_bokfort med verifikationsnummer", async () => {
  const utfall = await taEmotUnderlag(db, {
    tenantId: "kund_a",
    kalla: "app",
    inlamnadAv: "klient:test",
    innehall: { typ: "text", text: kaffefaktura("2026-07-16", 6) },
  });
  await körAllaJobb();
  await decideProposal(db, {
    tenantId: "kund_a",
    proposalId: await forslagsIdForUnderlag("kund_a", utfall.underlag_id),
    outcome: "approved",
    decidedBy: "konsult:test",
  });

  const laget = await lagesSiffror(db, "kund_a");
  assert.ok(laget.senast_bokfort);
  assert.ok((laget.senast_bokfort!.verifikationsnummer ?? 0) > 0);
  assert.ok(laget.inlamnat_manad >= 1);
});

test("webhookHemlighetOk: fail-closed i produktion, matchkrav när hemlighet finns", () => {
  const miljoFore = process.env.NODE_ENV;
  const hemlighetFore = process.env.INBOUND_MAIL_SECRET;
  try {
    delete process.env.INBOUND_MAIL_SECRET;
    (process.env as Record<string, string>).NODE_ENV = "test";
    assert.equal(webhookHemlighetOk(null), true);

    (process.env as Record<string, string>).NODE_ENV = "production";
    assert.equal(webhookHemlighetOk(null), false, "produktion utan hemlighet är stängd");

    process.env.INBOUND_MAIL_SECRET = "wh_hemlig";
    assert.equal(webhookHemlighetOk("wh_hemlig"), true);
    assert.equal(webhookHemlighetOk("fel"), false);
    assert.equal(webhookHemlighetOk(null), false);
  } finally {
    if (miljoFore === undefined) delete (process.env as Record<string, unknown>).NODE_ENV;
    else (process.env as Record<string, string>).NODE_ENV = miljoFore;
    if (hemlighetFore === undefined) delete process.env.INBOUND_MAIL_SECRET;
    else process.env.INBOUND_MAIL_SECRET = hemlighetFore;
  }
});

test("hoppad mejlbilaga lämnar audit-spår — aldrig spårlös", async () => {
  await laggTillAvsandare(db, {
    tenantId: "kund_a",
    email: "sparbar@kund-a.se",
    registreradAv: "klient:test",
  });
  const utfall = await taEmotInboundMejl(db, {
    till: ["kvitto+kund_a@inbound.grundbok.example"],
    fran: "sparbar@kund-a.se",
    amne: "HEIC-foto",
    text: "",
    bilagor: [{ filnamn: "kvitto.heic", mime: "image/heic", base64: "aGVq" }],
  });
  assert.equal(utfall.status, "mottaget");
  assert.ok(utfall.status === "mottaget" && utfall.underlag.length === 0);

  const spar = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ event_type: string }>(
      `SELECT event_type FROM audit_log
       WHERE event_type IN ('mejl_bilaga_hoppad', 'mejl_utan_underlag')`,
    ),
  );
  const typer = spar.rows.map((r) => r.event_type);
  assert.ok(typer.includes("mejl_bilaga_hoppad"));
  assert.ok(typer.includes("mejl_utan_underlag"));
});

test("storleksgränsen: för stor fil → 413 vid porten", async () => {
  const inbjudan = await skapaKlientInbjudan(db, {
    tenantId: "kund_a",
    email: "stor@kund-a.se",
    skapadAv: "konsult:test",
  });
  const klient = await losInKlientInbjudan(db, {
    token: inbjudan.token,
    namn: "Stor Fil",
    losenord: "klientlosen-13",
  });
  const svar = await intakePort(
    db,
    new Request("http://test.local/api/intake", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `grundbok_session=${encodeURIComponent(klient.sessionToken)}`,
      },
      body: JSON.stringify({
        fil: { base64: "A".repeat(11_000_001), mime: "image/jpeg", filnamn: "enorm.jpg" },
      }),
    }),
  );
  assert.equal(svar.http, 413);
});

test("RLS-skrivvakten: insert med fel tenant_id i tenant-kontext avvisas", async () => {
  await assert.rejects(
    withTenant(db, "kund_b", (tx) =>
      tx.query(
        `INSERT INTO underlag (tenant_id, document_id, kalla, content_hash, inlamnad_av)
         VALUES ('kund_a', gen_random_uuid(), 'app', 'smyghash', 'test')`,
      ),
    ),
    /row-level security|violates/i,
  );
});

test("migrate() är omkörningsbar mot befintlig data — klientmedlemskapet överlever", async () => {
  const fore = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM memberships WHERE role = 'klient'`,
  );
  assert.ok(Number(fore.rows[0].n) >= 1);

  // Ny uppstart mot samma databas: constraint-DROP/ADD och alla
  // idempotenta steg körs om utan att data eller roller går sönder.
  await migrate(db);

  const efter = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM memberships WHERE role = 'klient'`,
  );
  assert.equal(Number(efter.rows[0].n), Number(fore.rows[0].n));
});
