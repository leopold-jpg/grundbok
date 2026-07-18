// Underlagsjakten (WP33): kompletteringskön — auto-rad ur missing_receipt,
// "Fråga kunden", påminnelse, svarsregistrering med Rex-dokumentation i
// audit-loggen, och månadsgrönt v0. Deterministisk fallback som i resten
// av sviten.
process.env.GRUNDBOK_FORCE_FALLBACK = "1";

import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { withTenant } from "../src/lib/db/tenant";
import { skapaAgentNyckel } from "../src/lib/agent-auth";
import { körJobb } from "../src/workers/run-agent";
import { decideProposal } from "../src/lib/decisions";
import {
  hamtaKompletteringar,
  skapaFraga,
  markeraPamind,
  registreraSvar,
  manadsStatus,
  byggPaminnelseUtkast,
} from "../src/lib/kompletteringar";
import { FALL_5_DELMATCHNING } from "./golden-underlag";

const db = await createDb();

async function korDelmatchning(tenantId: string, jobbId: string): Promise<string> {
  const { id: agentId } = await skapaAgentNyckel(db, {
    tenantId,
    module: "bokforing",
    scopes: ["proposals:write"],
    namn: `komp-agent-${jobbId}`,
    template: { id: "bokforing", major: "1" },
  });
  const doc = await withTenant(db, tenantId, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO documents (tenant_id, raw) VALUES ($1, $2) RETURNING id`,
      [tenantId, FALL_5_DELMATCHNING],
    );
    return r.rows[0].id;
  });
  const utfall = await körJobb(db, {
    job_id: jobbId,
    tenant_id: tenantId,
    module: "bokforing",
    trigger: "test",
    agent_id: agentId,
    payload_ref: `document:${doc}`,
  });
  assert.equal(utfall.utfall, "klar");
  return (utfall as { proposal_id: string }).proposal_id;
}

test("missing_receipt-flaggat förslag skapar automatiskt en kompletteringsrad", async () => {
  const proposalId = await korDelmatchning("kund_a", "komp-auto-1");
  const rader = await hamtaKompletteringar(db, "kund_a");
  const rad = rader.find((r) => r.proposal_id === proposalId);
  assert.ok(rad, "kompletteringsraden saknas");
  assert.equal(rad.typ, "missing_receipt");
  assert.equal(rad.status, "open");
  assert.equal(rad.belopp_ore, 40_000); // restbeloppet ur flaggdatan
  assert.ok(rad.beskrivning.includes("saknar kvitto"));
  assert.ok(rad.proposal_summary.length > 0);
});

test("fråga kunden: kompletteringsrad typ 'fraga' + auditspår", async () => {
  const proposalId = await korDelmatchning("kund_a", "komp-fraga-1");
  const { id } = await skapaFraga(db, {
    tenantId: "kund_a",
    proposalId,
    fraga: "Vad avsåg transaktionen på 400 kr den 12 juni?",
    stalldAv: "konsult-test",
  });
  const rader = await hamtaKompletteringar(db, "kund_a");
  const rad = rader.find((r) => r.id === id)!;
  assert.equal(rad.typ, "fraga");
  assert.equal(rad.status, "open");

  const audit = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ payload: { kompletteringId: string; fraga: string } }>(
      `SELECT payload FROM audit_log WHERE event_type = 'komplettering_fraga'`,
    ),
  );
  assert.ok(audit.rows.some((r) => r.payload.kompletteringId === id));
});

test("tom fråga och fråga mot annan tenants förslag avvisas", async () => {
  const proposalId = await korDelmatchning("kund_a", "komp-fraga-2");
  await assert.rejects(
    () => skapaFraga(db, { tenantId: "kund_a", proposalId, fraga: "   ", stalldAv: "x" }),
    /tom/,
  );
  // RLS: kund_b ser inte kund_a:s förslag — frågan kan inte fästas.
  await assert.rejects(
    () => skapaFraga(db, { tenantId: "kund_b", proposalId, fraga: "test?", stalldAv: "x" }),
    /finns inte/,
  );
});

test("påminnelse: open → paminnd med tidsstämpel; svar: → klar med Rex-dokumentation", async () => {
  const proposalId = await korDelmatchning("kund_a", "komp-flode-1");
  const rad = (await hamtaKompletteringar(db, "kund_a")).find(
    (r) => r.proposal_id === proposalId,
  )!;

  await markeraPamind(db, { tenantId: "kund_a", kompletteringId: rad.id, paminddAv: "konsult-test" });
  const pamind = (await hamtaKompletteringar(db, "kund_a")).find((r) => r.id === rad.id)!;
  assert.equal(pamind.status, "paminnd");
  assert.ok(pamind.senast_paminnd);

  await registreraSvar(db, {
    tenantId: "kund_a",
    kompletteringId: rad.id,
    svar: "Kvittot inskickat via mejl 18 juli.",
    registreratAv: "konsult-test",
  });
  const klar = (await hamtaKompletteringar(db, "kund_a")).find((r) => r.id === rad.id)!;
  assert.equal(klar.status, "klar");
  assert.equal(klar.svar, "Kvittot inskickat via mejl 18 juli.");

  // Rex-dokumentationen: svaret är fäst vid FÖRSLAGET i audit-loggen.
  const audit = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ payload: { proposalId: string; svar: string } }>(
      `SELECT payload FROM audit_log WHERE event_type = 'kompletteringssvar'`,
    ),
  );
  const spår = audit.rows.find((r) => r.payload.proposalId === proposalId);
  assert.ok(spår, "kompletteringssvaret saknas i audit-loggen");
  assert.equal(spår.payload.svar, "Kvittot inskickat via mejl 18 juli.");

  // En klar rad kan varken påminnas eller besvaras igen.
  await assert.rejects(
    () => markeraPamind(db, { tenantId: "kund_a", kompletteringId: rad.id, paminddAv: "x" }),
    /redan klar/,
  );
  await assert.rejects(
    () =>
      registreraSvar(db, { tenantId: "kund_a", kompletteringId: rad.id, svar: "nytt", registreratAv: "x" }),
    /redan klar/,
  );
});

test("RLS: kund_b ser aldrig kund_a:s kompletteringar", async () => {
  await korDelmatchning("kund_a", "komp-rls-1");
  const hosB = await hamtaKompletteringar(db, "kund_b");
  assert.equal(hosB.length, 0);
});

test("månadsgrönt v0: grön först när attestkön OCH kompletteringskön är tomma", async () => {
  // Egen databas — nuläges-beräkningen ska inte störas av andra tester.
  const db2 = await createDb();
  const fore = await manadsStatus(db2, "kund_a");
  assert.equal(fore.gron, true);

  // Delmatchat förslag: pending i attestkön + öppen komplettering → gult.
  const { id: agentId } = await skapaAgentNyckel(db2, {
    tenantId: "kund_a",
    module: "bokforing",
    scopes: ["proposals:write"],
    namn: "komp-manad-agent",
    template: { id: "bokforing", major: "1" },
  });
  const doc = await withTenant(db2, "kund_a", async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO documents (tenant_id, raw) VALUES ($1, $2) RETURNING id`,
      ["kund_a", FALL_5_DELMATCHNING],
    );
    return r.rows[0].id;
  });
  const utfall = await körJobb(db2, {
    job_id: "komp-manad-1",
    tenant_id: "kund_a",
    module: "bokforing",
    trigger: "test",
    agent_id: agentId,
    payload_ref: `document:${doc}`,
  });
  assert.equal(utfall.utfall, "klar");
  const proposalId = (utfall as { proposal_id: string }).proposal_id;

  const mitt = await manadsStatus(db2, "kund_a");
  assert.equal(mitt.gron, false);
  assert.equal(mitt.attest_vantar, 1);
  assert.equal(mitt.kompletteringar_oppna, 1);

  // Attestera + registrera svar → grönt igen (e2e-kedjan i WP34 kör
  // samma flöde genom API-lagret).
  await decideProposal(db2, {
    tenantId: "kund_a",
    proposalId,
    outcome: "approved",
    decidedBy: "konsult-test",
  });
  const rad = (await hamtaKompletteringar(db2, "kund_a"))[0];
  await registreraSvar(db2, {
    tenantId: "kund_a",
    kompletteringId: rad.id,
    svar: "kvitto inkom",
    registreratAv: "konsult-test",
  });
  const efter = await manadsStatus(db2, "kund_a");
  assert.equal(efter.gron, true);
});

test("påminnelseutkastet är färdigt och vänligt — belopp och kontext med", () => {
  const utkast = byggPaminnelseUtkast("Café Exempel AB", [
    {
      typ: "missing_receipt",
      beskrivning: "Delmatchning: 400,00 kr saknar kvitto.",
      belopp_ore: 40_000,
      proposal_summary: "Kortavräkning juni — 3 transaktioner",
    },
    {
      typ: "fraga",
      beskrivning: "Vad avsåg uttaget den 12 juni?",
      belopp_ore: null,
      proposal_summary: "Kortavräkning juni — 3 transaktioner",
    },
  ]);
  assert.ok(utkast.subject.includes("Café Exempel AB"));
  assert.ok(utkast.body.includes("400,00 kr"));
  assert.ok(utkast.body.includes("Kortavräkning juni"));
  assert.ok(utkast.body.includes("Vad avsåg uttaget den 12 juni?"));
  assert.ok(utkast.body.startsWith("Hej!"));
});
