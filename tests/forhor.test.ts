import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDb } from "../src/lib/db/client";
import { handleProposal, decideProposal, type Principal } from "../src/lib/decisions";
import { forhorsUnderlag } from "../src/ytor/forhor";
import { exempelProposal } from "./helpers";

// Förhörschatten lager 1 (WP40): Varför-panelens deterministiska
// underlag. Ingen LLM — allt läses ur befintliga tabeller, RLS-scopat.

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
