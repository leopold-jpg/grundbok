// Golden-tester för förhörschatten (WP43) — förhör på de VERKLIGA
// golden-fallen (WP32-underlagen körda genom hela worker-pipelinen,
// ingen sidodörr). Kickoffens tre golden-krav:
//   fall 2 (ÄTA)        → svaret citerar paketregeln (regel-id som källa)
//   fall 1 (fel tenant) → svaret förklarar mottagarkontrollen
//   utanför kontext     → hänvisa till människa, aldrig ett svar i sak
// plus logg- och E2E-flödet: öppna förslag → V → fråga → svar med källa
// → syns i loggen.

process.env.GRUNDBOK_FORCE_FALLBACK = "1";

import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { withTenant } from "../src/lib/db/tenant";
import { skapaAgentNyckel } from "../src/lib/agent-auth";
import { körJobb } from "../src/workers/run-agent";
import type { AgentJobb } from "../src/lib/queue";
import { PgliteAuth } from "../src/auth/pglite-auth";
import { attestKo, beslutsLogg, kundfragorForByra } from "../src/ytor/byra";
import { eskaleraKundfraga } from "../src/modules/kundassistent";
import { forhorsUnderlag } from "../src/ytor/forhor";
import { forhorFraga } from "../src/modules/forhor";
import { FALL_1_FEL_MOTTAGARE, FALL_2_ATA_AVVIKELSE } from "./golden-underlag";

const db = await createDb();
const auth = new PgliteAuth(db);

const agentCache = new Map<string, string>();
async function agentFor(tenantId: string): Promise<string> {
  const cached = agentCache.get(tenantId);
  if (cached) return cached;
  const { id } = await skapaAgentNyckel(db, {
    tenantId,
    module: "bokforing",
    scopes: ["proposals:write"],
    namn: `forhor-golden-agent-${tenantId}`,
    template: { id: "bokforing", major: "1" },
  });
  agentCache.set(tenantId, id);
  return id;
}

/** Underlag → dokument → worker-pipeline → proposal-id. Samma väg som
 *  produktionen (golden-fall.test.ts-mönstret). */
async function körFall(tenantId: string, underlag: string, jobbId: string): Promise<string> {
  const doc = await withTenant(db, tenantId, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO documents (tenant_id, raw) VALUES ($1, $2) RETURNING id`,
      [tenantId, underlag],
    );
    return r.rows[0].id;
  });
  const jobb: AgentJobb = {
    job_id: jobbId,
    tenant_id: tenantId,
    module: "bokforing",
    trigger: "golden",
    agent_id: await agentFor(tenantId),
    payload_ref: `document:${doc}`,
  };
  const utfall = await körJobb(db, jobb);
  assert.ok(utfall.utfall === "klar", `jobbet föll: ${JSON.stringify(utfall)}`);
  return utfall.proposal_id;
}

// ================================================== golden: fall 2 (ÄTA)

test("förhörsgolden fall 2: ÄTA-frågan citerar paketregeln ata-vaksamhet", async () => {
  const proposalId = await körFall("kund_b", FALL_2_ATA_AVVIKELSE, "forhor-golden-2");

  const svar = await forhorFraga(db, {
    tenantId: "kund_b",
    proposalId,
    fraga: "Vad säger ÄTA-vaksamheten om det här förslaget?",
    stalldAv: "konsult-test",
  });
  assert.ok(svar);
  // Paketregeln citeras med regel-id som källa — inte bara flaggan.
  assert.ok(
    svar!.kallor.some((k) => k.typ === "paketregel" && k.ref === "ata-vaksamhet"),
    `paketregeln saknas bland källorna: ${JSON.stringify(svar!.kallor)}`,
  );
  assert.ok(svar!.svar.includes("ata-vaksamhet"));
  assert.ok(/AB 04|ABT 06/.test(svar!.svar), "lagrumet (AB 04/ABT 06) ska följa med citatet");
  assert.equal(svar!.hanvisa_till_manniska, false);
});

// =========================================== golden: fall 1 (fel tenant)

test("förhörsgolden fall 1: varför-frågan förklarar mottagarkontrollen", async () => {
  const proposalId = await körFall("kund_a", FALL_1_FEL_MOTTAGARE, "forhor-golden-1");

  const svar = await forhorFraga(db, {
    tenantId: "kund_a",
    proposalId,
    fraga: "Varför konterades den här fakturan inte?",
    stalldAv: "konsult-test",
  });
  assert.ok(svar);
  assert.ok(
    svar!.kallor.some((k) => k.typ === "flagga" && k.ref === "flag_wrong_tenant"),
    `mottagarkontrollens flagga saknas bland källorna: ${JSON.stringify(svar!.kallor)}`,
  );
  // Förklaringen är flaggans egen text: fel mottagare, ingen kontering.
  assert.ok(/ställt till/.test(svar!.svar));
  assert.ok(/Ingen kontering|bokförs aldrig/.test(svar!.svar));
});

// ======================================== golden: utanför kontexten

test("förhörsgolden: fråga utanför kontexten hänvisas till människa", async () => {
  const proposalId = await körFall("kund_a", FALL_1_FEL_MOTTAGARE, "forhor-golden-manniska");

  const svar = await forhorFraga(db, {
    tenantId: "kund_a",
    proposalId,
    fraga: "Ska jag byta bolagsform?",
    stalldAv: "konsult-test",
  });
  assert.ok(svar);
  assert.equal(svar!.hanvisa_till_manniska, true);
  assert.ok(/människa/i.test(svar!.svar));
  // Aldrig ett svar i sak: inga käll-citat ur förslagets underlag.
  assert.ok(!svar!.kallor.some((k) => k.typ === "paketregel" || k.typ === "verifikat"));
});

// ============================================== logg + E2E-flödet

test("E2E: öppna förslag → V → ställ fråga → svar med källa → syns i loggen", async () => {
  const inloggning = await auth.login("konsult.ett@byran-exempel.se", "grundbok-dev");
  const session = (await auth.session(inloggning!.token))!;

  // 1. Förslaget ligger i attestkön (det konsulten ser i /byra).
  const proposalId = await körFall("kund_b", FALL_2_ATA_AVVIKELSE, "forhor-golden-e2e");
  const ko = await attestKo(db, session, "kund_b");
  const rad = ko.find((r) => r.id === proposalId);
  assert.ok(rad, "förslaget ska ligga i attestkön");

  // 2. V — Varför-panelen (GET /api/byra/forhor): lager 1-underlaget.
  const underlag = await forhorsUnderlag(db, "kund_b", proposalId);
  assert.ok(underlag);
  assert.ok(underlag!.paket.some((p) => p.regler.some((r) => r.id === "ata-vaksamhet")));
  assert.ok(underlag!.proposal.flaggor.some((f) => f.id === "ata_avvikelse"));
  assert.ok(underlag!.policyutfall.missade_villkor.length > 0);

  // 3. Frågan (POST /api/byra/forhor) — svar med källa.
  const fraga = "Hur förhåller sig beloppet till det kända ordervärdet?";
  const svar = await forhorFraga(db, {
    tenantId: "kund_b",
    proposalId,
    fraga,
    stalldAv: session.user.id,
  });
  assert.ok(svar);
  assert.ok(svar!.kallor.length > 0, "svaret ska bära minst en källa");

  // 4a. Fråga + svar är fästa vid förslaget i audit-kedjan (WP33-mönstret).
  const audit = await withTenant(db, "kund_b", (tx) =>
    tx.query<{ payload: { fraga: string; svar: string; stalldAv: string } }>(
      `SELECT payload FROM audit_log WHERE event_type = 'forhor'
       AND payload->>'proposalId' = $1`,
      [proposalId],
    ),
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].payload.fraga, fraga);
  assert.equal(audit.rows[0].payload.stalldAv, session.user.id);

  // 4b. Svaret (advisory_answer, konfidens ≥ 0.5) syns i beslutsloggen
  // som policybeslut — samma logg konsulten ser i /byra.
  const logg = await beslutsLogg(db, session, "kund_b");
  const svarsRad = logg.find((l) => l.proposal_id === svar!.svar_proposal_id);
  assert.ok(svarsRad, "förhörssvaret ska synas i beslutsloggen");
  assert.equal(svarsRad!.kind, "advisory_answer");
  assert.equal(svarsRad!.policy_beslut, true);
});

// ======================================= samexistens med Frågor (WP24)

test("detaljpanelens förhör och fliken Frågor samexisterar — skilda kanaler, samma session", async () => {
  // Intaget (WP24) la en Frågor-flik intill attestkön: kundens
  // eskalerade frågor ur appen. Förhöret är konsultens fråga till
  // AGENTEN om ett förslag. Kanalerna får aldrig blandas ihop — det
  // ena ärendet ska inte dyka upp i den andras kö.
  const inloggning = await auth.login("konsult.ett@byran-exempel.se", "grundbok-dev");
  const session = (await auth.session(inloggning!.token))!;

  const kundensFraga = "Kan jag dra av min nya kaffemaskin?";
  await eskaleraKundfraga(db, {
    tenantId: "kund_a",
    fraga: kundensFraga,
    stalldAv: "klient:samexistens-test",
  });

  const proposalId = await körFall("kund_a", FALL_1_FEL_MOTTAGARE, "forhor-golden-samexistens");
  const forhorsFraga = "Varför konterades den här fakturan inte?";
  const svar = await forhorFraga(db, {
    tenantId: "kund_a",
    proposalId,
    fraga: forhorsFraga,
    stalldAv: session.user.id,
  });
  assert.ok(svar);

  // Frågor-fliken ser kundens fråga — aldrig konsultens förhör.
  const fragor = await kundfragorForByra(db, session, "kund_a");
  assert.ok(fragor.some((f) => f.fraga === kundensFraga));
  assert.ok(
    !fragor.some((f) => f.fraga === forhorsFraga),
    "förhörsfrågan får aldrig hamna i kundens frågekö",
  );

  // Förhöret ligger kvar i sin egen kanal (audit-kedjan på förslaget).
  const audit = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ payload: { fraga: string } }>(
      `SELECT payload FROM audit_log WHERE event_type = 'forhor'
       AND payload->>'proposalId' = $1`,
      [proposalId],
    ),
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].payload.fraga, forhorsFraga);

  // Och attestkön (detaljpanelens hemvist) är opåverkad av kundfrågan.
  const ko = await attestKo(db, session, "kund_a");
  assert.ok(ko.some((r) => r.id === proposalId));
});

// ==================================================== RLS över svaret

test("förhöret bygger aldrig svar på en annan tenants historik", async () => {
  // Samma motpartsnamn hos båda tenanterna: kund_a har bokförda verifikat,
  // kund_b har inga. Ett historik-svar hos kund_b får inte se kund_a:s.
  const motpart = "Underentreprenad Exempel AB";
  const proposalId = await körFall("kund_b", FALL_2_ATA_AVVIKELSE, "forhor-golden-rls");

  await withTenant(db, "kund_a", async (tx) => {
    const v = await tx.query<{ id: string }>(
      `INSERT INTO verifications (tenant_id, nummer, affarshandelsedatum, beskrivning, motpart)
       VALUES ('kund_a', 9901, '2026-06-01', 'Främmande verifikat', $1) RETURNING id`,
      [motpart],
    );
    await tx.query(
      `INSERT INTO verification_rows (tenant_id, verification_id, konto, kontonamn, debet_ore, kredit_ore)
       VALUES ('kund_a', $1, '4010', 'Inköp', 50_000, 0), ('kund_a', $1, '2440', 'Skuld', 0, 50_000)`,
      [v.rows[0].id],
    );
  });

  const svar = await forhorFraga(db, {
    tenantId: "kund_b",
    proposalId,
    fraga: "Hur hanterades tidigare fakturor från denna leverantör?",
    stalldAv: "konsult-test",
  });
  assert.ok(svar);
  // kund_b:s egen historik för motparten (bortsett från ev. egna golden-
  // körningar i denna fil) innehåller ALDRIG kund_a:s verifikat V9901.
  assert.ok(!svar!.svar.includes("V9901"));
  assert.ok(!svar!.svar.includes("Främmande verifikat"));
  assert.ok(!svar!.kallor.some((k) => k.ref === "V9901"));
});
