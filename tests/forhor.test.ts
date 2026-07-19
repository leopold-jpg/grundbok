// Deterministisk motor i test — flaggan läses vid anrop, inte vid
// import, så toppen av filen räcker (samma mönster som radgivning.test).
process.env.GRUNDBOK_FORCE_FALLBACK = "1";

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDb } from "../src/lib/db/client";
import { withTenant } from "../src/lib/db/tenant";
import { handleProposal, decideProposal, type Principal } from "../src/lib/decisions";
import { forhorsUnderlag } from "../src/ytor/forhor";
import {
  forhorFraga,
  forhorChattAktiv,
  forhorsFragorIdag,
  ForhorsTakError,
  FORHOR_TAK_PER_DAG,
} from "../src/modules/forhor";
import { auditera } from "../src/lib/ledger";
import { exempelProposal } from "./helpers";

// Förhörschatten (WP40/WP41): Varför-panelens deterministiska underlag
// och förhörsflödet — kontext strikt ur tenantens data, källhänvisning
// per påstående, dubbel persistens (advisory_answer + audit-kedjan).

const db = await createDb();

const principalA: Principal = {
  typ: "intern",
  tenant_id: "kund_a",
  module: "bokforing",
  scopes: ["proposals:write"],
  namn: "test",
};
const principalB: Principal = { ...principalA, tenant_id: "kund_b" };

test("forhorsUnderlag: motivering, flaggor, policyutfall och provenance ur förslaget", async () => {
  const p = exempelProposal({
    id: randomUUID(),
    contract_version: "0.3.0",
    mall_id: "bokforing",
    mall_version: "1.1.0",
  });
  assert.equal((await handleProposal(db, principalA, p)).status, "pending");

  const u = await forhorsUnderlag(db, "kund_a", p.id);
  assert.ok(u);
  assert.equal(u!.proposal.summary, p.summary);
  assert.equal(u!.proposal.status, "pending");
  assert.equal(u!.proposal.motpart, "Kafferosteriet Exempel AB");
  assert.equal(u!.proposal.provenance.model, "claude-opus-4-8");
  assert.equal(u!.proposal.provenance.mall, "bokforing@1.1.0");
  assert.ok(u!.proposal.legal.length > 0);
  // Default-policyn för bokforing är helt manuell (max 0 kr) — utfallet
  // ska förklara varför förslaget väntar på attest.
  assert.ok(u!.policyutfall.missade_villkor.length > 0);
  assert.ok(u!.policyutfall.policy);
  assert.equal(u!.policyutfall.policy!.max_belopp_ore, 0);
});

test("forhorsUnderlag: mallstämplat förslag hos byggtenant ger bygg-paketets regler med id", async () => {
  const p = exempelProposal({
    id: randomUUID(),
    tenant_id: "kund_b",
    contract_version: "0.3.0",
    mall_id: "bokforing",
    mall_version: "1.1.0",
    motpart: "Underentreprenör Exempel AB",
  });
  assert.equal((await handleProposal(db, principalB, p)).status, "pending");

  const u = await forhorsUnderlag(db, "kund_b", p.id);
  assert.ok(u);
  assert.equal(u!.paket.length, 1);
  assert.equal(u!.paket[0].id, "bygg");
  assert.equal(u!.paket[0].displayName, "Bygg");
  const regelIds = u!.paket[0].regler.map((r) => r.id);
  assert.ok(regelIds.includes("omvand-byggmoms"));
  assert.ok(regelIds.includes("ata-vaksamhet"));
});

test("forhorsUnderlag: ostämplat förslag (v0.2) faller tillbaka på tenantens bransch", async () => {
  const p = exempelProposal({ id: randomUUID() });
  assert.equal((await handleProposal(db, principalA, p)).status, "pending");

  const u = await forhorsUnderlag(db, "kund_a", p.id);
  assert.ok(u);
  // kund_a är caféet — branschen aktiverar restaurang-paketet.
  assert.deepEqual(u!.paket.map((x) => x.id), ["restaurang"]);
  assert.ok(u!.paket[0].regler.some((r) => r.id === "livsmedelsmoms"));
});

test("forhorsUnderlag: RLS — en annan tenants förslag är osynligt (null, inte fel)", async () => {
  const p = exempelProposal({ id: randomUUID() });
  assert.equal((await handleProposal(db, principalA, p)).status, "pending");

  assert.equal(await forhorsUnderlag(db, "kund_b", p.id), null);
  assert.equal(await forhorsUnderlag(db, "kund_a", randomUUID()), null);
});

test("forhorsUnderlag: motpartshistorik — verifikat + förslag, nyast först, max 3", async () => {
  const motpart = `Historik Exempel AB ${randomUUID().slice(0, 8)}`;

  // Två attesterade (→ verifikationer) och en avvisad + en färsk pending.
  const godkanda = [exempelProposal({ id: randomUUID(), motpart }), exempelProposal({ id: randomUUID(), motpart })];
  for (const p of godkanda) {
    assert.equal((await handleProposal(db, principalA, p)).status, "pending");
    await decideProposal(db, {
      tenantId: "kund_a",
      proposalId: p.id,
      outcome: "approved",
      decidedBy: "konsult-test",
    });
  }
  const avvisad = exempelProposal({ id: randomUUID(), motpart });
  assert.equal((await handleProposal(db, principalA, avvisad)).status, "pending");
  await decideProposal(db, {
    tenantId: "kund_a",
    proposalId: avvisad.id,
    outcome: "rejected",
    decidedBy: "konsult-test",
    reason: "test",
  });

  const aktuell = exempelProposal({ id: randomUUID(), motpart });
  assert.equal((await handleProposal(db, principalA, aktuell)).status, "pending");

  const u = await forhorsUnderlag(db, "kund_a", aktuell.id);
  assert.ok(u);
  // 3 av 3 möjliga (2 verifikat + 1 avvisat förslag) — det aktuella
  // förslaget ingår aldrig i sin egen historik.
  assert.equal(u!.historik.length, 3);
  assert.ok(u!.historik.every((h) => h.beskrivning.length > 0));

  const verifikat = u!.historik.filter((h) => h.typ === "verifikation");
  assert.equal(verifikat.length, 2);
  for (const v of verifikat) {
    assert.equal(v.utfall, "attesterad");
    assert.equal(v.konto, "4010");
    assert.equal(v.belopp_ore, 106_000);
    assert.ok(v.verifikationsnummer !== null);
  }
  const forslag = u!.historik.filter((h) => h.typ === "forslag");
  assert.equal(forslag.length, 1);
  assert.equal(forslag[0].utfall, "avvisad");
});

test("forhorsUnderlag: motpartshistoriken läcker aldrig över tenantgränsen", async () => {
  const motpart = `Gemensam Leverantör AB ${randomUUID().slice(0, 8)}`;

  // Samma motpartsnamn hos BÅDA tenanterna — historiken hos kund_b får
  // bara innehålla kund_b:s egna rader.
  const hosA = exempelProposal({ id: randomUUID(), motpart });
  assert.equal((await handleProposal(db, principalA, hosA)).status, "pending");
  await decideProposal(db, {
    tenantId: "kund_a",
    proposalId: hosA.id,
    outcome: "approved",
    decidedBy: "konsult-test",
  });

  const hosB = exempelProposal({ id: randomUUID(), tenant_id: "kund_b", motpart });
  assert.equal((await handleProposal(db, principalB, hosB)).status, "pending");

  const u = await forhorsUnderlag(db, "kund_b", hosB.id);
  assert.ok(u);
  assert.equal(u!.historik.length, 0);
});

// ------------------------------------------------------- WP41: chatten

test("forhorFraga: paketregelsfråga citerar regeln med regel-id som källa", async () => {
  const p = exempelProposal({
    id: randomUUID(),
    tenant_id: "kund_b",
    contract_version: "0.3.0",
    mall_id: "bokforing",
    mall_version: "1.1.0",
    motpart: "Underentreprenad Test AB",
  });
  assert.equal((await handleProposal(db, principalB, p)).status, "pending");

  const svar = await forhorFraga(db, {
    tenantId: "kund_b",
    proposalId: p.id,
    fraga: "Vad säger omvänd byggmoms här?",
    stalldAv: "konsult-test",
  });
  assert.ok(svar);
  assert.equal(svar!.motor, "fallback");
  assert.ok(svar!.svar.includes("omvand-byggmoms"));
  assert.ok(svar!.kallor.some((k) => k.typ === "paketregel" && k.ref === "omvand-byggmoms"));
  assert.equal(svar!.hanvisa_till_manniska, false);
});

test("forhorFraga: kontofråga besvaras ur agentens motivering med källa", async () => {
  const p = exempelProposal({ id: randomUUID() });
  assert.equal((await handleProposal(db, principalA, p)).status, "pending");

  const svar = await forhorFraga(db, {
    tenantId: "kund_a",
    proposalId: p.id,
    fraga: "Varför 4010 och inte 5460?",
    stalldAv: "konsult-test",
  });
  assert.ok(svar);
  assert.ok(svar!.svar.includes("4010"));
  assert.ok(svar!.kallor.some((k) => k.typ === "motivering"));
});

test("forhorFraga: rådgivningsfråga hänvisas till människa — aldrig ett svar i sak", async () => {
  const p = exempelProposal({ id: randomUUID() });
  assert.equal((await handleProposal(db, principalA, p)).status, "pending");

  const svar = await forhorFraga(db, {
    tenantId: "kund_a",
    proposalId: p.id,
    fraga: "Ska jag byta bolagsform till aktiebolag nästa år?",
    stalldAv: "konsult-test",
  });
  assert.ok(svar);
  assert.equal(svar!.hanvisa_till_manniska, true);
  assert.ok(/människa/i.test(svar!.svar));
});

test("forhorFraga: fråga utanför underlaget ger 'underlag saknas' — aldrig en gissning", async () => {
  const p = exempelProposal({ id: randomUUID() });
  assert.equal((await handleProposal(db, principalA, p)).status, "pending");

  const svar = await forhorFraga(db, {
    tenantId: "kund_a",
    proposalId: p.id,
    fraga: "Vad tycker du om vädret i Skåne?",
    stalldAv: "konsult-test",
  });
  assert.ok(svar);
  assert.ok(/underlag saknas/i.test(svar!.svar));
  assert.equal(svar!.hanvisa_till_manniska, true);
});

test("forhorFraga: fråga + svar fästs vid förslaget i audit-kedjan och svaret går genom porten", async () => {
  const p = exempelProposal({ id: randomUUID() });
  assert.equal((await handleProposal(db, principalA, p)).status, "pending");

  const fraga = "Varför konto 4010 för det här inköpet?";
  const svar = await forhorFraga(db, {
    tenantId: "kund_a",
    proposalId: p.id,
    fraga,
    stalldAv: "konsult-test",
  });
  assert.ok(svar);

  // Rex-kedjan: audit-händelsen bär fråga, svar, källor och pekar på det
  // FÖRHÖRDA förslaget (WP33-mönstret).
  const audit = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM audit_log WHERE event_type = 'forhor'
       AND payload->>'proposalId' = $1`,
      [p.id],
    ),
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].payload.fraga, fraga);
  assert.equal(audit.rows[0].payload.svar, svar!.svar);
  assert.equal(audit.rows[0].payload.stalldAv, "konsult-test");
  assert.equal(audit.rows[0].payload.svarProposalId, svar!.svar_proposal_id);

  // Svaret är ett advisory_answer-förslag genom porten — ingen sidodörr.
  const svarsRad = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ kind: string; payload: { provenance: { input_refs: string[] } } }>(
      `SELECT kind, payload FROM proposals WHERE id = $1`,
      [svar!.svar_proposal_id],
    ),
  );
  assert.equal(svarsRad.rows[0].kind, "advisory_answer");
  assert.ok(svarsRad.rows[0].payload.provenance.input_refs.includes(`proposal:${p.id}`));
});

// ------------------------------------------------ WP42: polish + gränser

test("forhorChattAktiv: på som förval, av med 0/false/av/off", () => {
  const innan = process.env.FORHOR_CHAT_ENABLED;
  try {
    delete process.env.FORHOR_CHAT_ENABLED;
    assert.equal(forhorChattAktiv(), true);
    process.env.FORHOR_CHAT_ENABLED = "1";
    assert.equal(forhorChattAktiv(), true);
    for (const av of ["0", "false", "av", "off", "nej", " AV "]) {
      process.env.FORHOR_CHAT_ENABLED = av;
      assert.equal(forhorChattAktiv(), false, `"${av}" ska stänga av`);
    }
  } finally {
    if (innan === undefined) delete process.env.FORHOR_CHAT_ENABLED;
    else process.env.FORHOR_CHAT_ENABLED = innan;
  }
});

test("kostnadsvakt: fråga 21 stoppas med vänligt tak — räknat ur audit-kedjan", async () => {
  // Egen isolerad db: taket räknas ur nuläget och får inte kontamineras
  // av andra testers förhör (samma mönster som kompletteringar.test.ts).
  const db2 = await createDb();
  const p = exempelProposal({ id: randomUUID() });
  assert.equal((await handleProposal(db2, principalA, p)).status, "pending");

  // Fyll dygnskvoten via samma kanal som räknaren läser (audit-kedjan).
  await withTenant(db2, "kund_a", async (tx) => {
    for (let i = 0; i < FORHOR_TAK_PER_DAG; i++) {
      await auditera(tx, "kund_a", "forhor", { proposalId: p.id, fraga: `fråga ${i}` });
    }
  });
  assert.equal(await forhorsFragorIdag(db2, "kund_a"), FORHOR_TAK_PER_DAG);

  await assert.rejects(
    forhorFraga(db2, {
      tenantId: "kund_a",
      proposalId: p.id,
      fraga: "Varför konto 4010?",
      stalldAv: "konsult-test",
    }),
    (err: unknown) => {
      assert.ok(err instanceof ForhorsTakError);
      assert.match((err as Error).message, /öppnar igen i morgon/);
      return true;
    },
  );

  // Taket är per tenant: kund_b är opåverkad.
  assert.equal(await forhorsFragorIdag(db2, "kund_b"), 0);
});

test("forhorFraga: RLS — en annan tenants förslag kan aldrig förhöras", async () => {
  const p = exempelProposal({ id: randomUUID() });
  assert.equal((await handleProposal(db, principalA, p)).status, "pending");

  const svar = await forhorFraga(db, {
    tenantId: "kund_b",
    proposalId: p.id,
    fraga: "Varför ser jag det här?",
    stalldAv: "konsult-test",
  });
  assert.equal(svar, null);

  // Inget audit-spår hos fel tenant.
  const audit = await withTenant(db, "kund_b", (tx) =>
    tx.query(`SELECT 1 FROM audit_log WHERE event_type = 'forhor' AND payload->>'proposalId' = $1`, [p.id]),
  );
  assert.equal(audit.rows.length, 0);
});
