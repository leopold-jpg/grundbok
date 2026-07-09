import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { withTenant } from "../src/lib/db/tenant";
import {
  evaluateAutonomy,
  handleProposal,
  decideProposal,
  sparaPolicy,
  type Principal,
  type PolicyRad,
} from "../src/lib/decisions";
import { exempelProposal } from "./helpers";
import { hashProposal, sha256Hex } from "../src/contracts";

// WP2: beslutsmotorn — porten mellan förslagskontraktet och huvudboken.

const db = await createDb();

const intern: Principal = {
  typ: "intern",
  tenant_id: "kund_a",
  module: "*",
  scopes: ["proposals:write"],
  namn: "test-intern",
};

// Öppna upp kund_a:s bokföringspolicy för auto-testerna:
// max 5 000 kr, confidence ≥ 0.8, okända motparter OK.
const oppenPolicy: PolicyRad = {
  tenant_id: "kund_a",
  module: "bokforing",
  max_belopp_ore: 500_000,
  min_confidence: 0.8,
  kanda_motparter_endast: false,
  tillatna_kinds: ["journal_entry"],
};
await sparaPolicy(db, oppenPolicy);

test("evaluateAutonomy: ren funktion listar exakt vilka villkor som missas", () => {
  const p = exempelProposal({ confidence: 0.5, lines: [
    { konto: "4010", benamning: "x", debet_ore: 900_000, kredit_ore: 0 },
    { konto: "2440", benamning: "y", debet_ore: 0, kredit_ore: 900_000 },
  ] });
  const utfall = evaluateAutonomy(p, oppenPolicy, false);
  assert.equal(utfall.auto, false);
  assert.equal(utfall.missade.length, 2); // confidence + belopp
});

test("auto_approve: förslag inom policyn bokförs direkt med policy-identitet", async () => {
  const p = exempelProposal();
  const r = await handleProposal(db, intern, p);
  assert.equal(r.status, "auto_approved");
  if (r.status !== "auto_approved") return;
  assert.ok(r.verifikation);
  assert.ok(r.verifikation!.nummer >= 1);

  const beslut = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ decided_by: string; outcome: string; verifikationsnummer: number }>(
      `SELECT decided_by, outcome, verifikationsnummer FROM decisions WHERE proposal_id = $1`,
      [p.id],
    ),
  );
  assert.equal(beslut.rows[0].outcome, "auto_approved");
  assert.equal(beslut.rows[0].decided_by, "policy:kund_a/bokforing");
  assert.equal(Number(beslut.rows[0].verifikationsnummer), r.verifikation!.nummer);
});

test("auto_approve respekterar max_belopp: över gränsen → godkännandekön", async () => {
  const p = exempelProposal({
    lines: [
      { konto: "4010", benamning: "Stort inköp", debet_ore: 600_000, kredit_ore: 0 },
      { konto: "2440", benamning: "Leverantörsskulder", debet_ore: 0, kredit_ore: 600_000 },
    ],
  });
  const r = await handleProposal(db, intern, p);
  assert.equal(r.status, "pending");
  if (r.status !== "pending") return;
  assert.ok(r.missade_villkor.some((v) => v.includes("belopp")));
});

test("correction-undantaget: rättelser auto-godkänns aldrig, även om policyn tillåter kind", async () => {
  // Lägg correction i tillåtna kinds — hårda regeln ska ändå vinna.
  await sparaPolicy(db, { ...oppenPolicy, tillatna_kinds: ["journal_entry", "correction"] });

  // Skapa en verifikation att rätta (via ett auto-godkänt journal_entry).
  const original = await handleProposal(db, intern, exempelProposal());
  if (original.status !== "auto_approved" || !original.verifikation) {
    throw new Error("förväntade auto_approved original");
  }
  const rattelse = exempelProposal({
    kind: "correction",
    summary: "Rättelse av felkontering",
    lines: [
      { konto: "2440", benamning: "Leverantörsskulder", debet_ore: 106_000, kredit_ore: 0 },
      { konto: "4010", benamning: "Inköp material och varor", debet_ore: 0, kredit_ore: 100_000 },
      { konto: "2641", benamning: "Debiterad ingående moms", debet_ore: 0, kredit_ore: 6_000 },
    ],
    provenance: {
      model: "claude-opus-4-8",
      prompt_hash: sha256Hex("x"),
      module_version: "0.2.0",
      input_refs: [`verification:${original.verifikation.id}`],
      injection_screened: true,
    },
  });
  const r = await handleProposal(db, intern, rattelse);
  assert.equal(r.status, "pending");
  if (r.status !== "pending") return;
  assert.ok(r.missade_villkor.some((v) => v.includes("correction")));

  // Konsulten godkänner → rättelsen bokförs med referens.
  const beslut = await decideProposal(db, {
    tenantId: "kund_a",
    proposalId: rattelse.id,
    outcome: "approved",
    decidedBy: "konsult@byran.se",
  });
  assert.equal(beslut.outcome, "approved");
  if (beslut.outcome !== "approved") return;
  const ref = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ rattar_verifikation: string }>(
      `SELECT rattar_verifikation FROM verifications WHERE id = $1`,
      [beslut.verifikation!.id],
    ),
  );
  assert.equal(ref.rows[0].rattar_verifikation, original.verifikation.id);

  await sparaPolicy(db, oppenPolicy); // återställ
});

test("manipulerad hash avvisas vid porten — inget sparas", async () => {
  const p = exempelProposal({ hash: "0".repeat(64) });
  const r = await handleProposal(db, intern, p);
  assert.equal(r.status, "avvisad_vid_porten");
  const sparad = await withTenant(db, "kund_a", (tx) =>
    tx.query(`SELECT 1 FROM proposals WHERE id = $1`, [p.id]),
  );
  assert.equal(sparad.rows.length, 0);
});

test("principalens tenant måste matcha förslagets", async () => {
  const p = exempelProposal({ tenant_id: "kund_b" });
  const r = await handleProposal(db, intern, p); // intern är kund_a
  assert.equal(r.status, "avvisad_vid_porten");
  if (r.status !== "avvisad_vid_porten") return;
  assert.equal(r.http, 403);
});

test("idempotens: samma förslags-id två gånger → duplicate, aldrig dubbelbokfört", async () => {
  const p = exempelProposal();
  const forsta = await handleProposal(db, intern, p);
  assert.equal(forsta.status, "auto_approved");
  const andra = await handleProposal(db, intern, p);
  assert.equal(andra.status, "duplicate");

  const antal = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM verifications WHERE proposal_id = $1`,
      [p.id],
    ),
  );
  assert.equal(Number(antal.rows[0].n), 1);
});

test("pending-förslag: mänskligt beslut bokför; avvisning kräver motivering", async () => {
  const stor = () =>
    exempelProposal({
      lines: [
        { konto: "4010", benamning: "Stort inköp", debet_ore: 700_000, kredit_ore: 0 },
        { konto: "2440", benamning: "Leverantörsskulder", debet_ore: 0, kredit_ore: 700_000 },
      ],
    });

  const p1 = stor();
  await handleProposal(db, intern, p1);
  const godkant = await decideProposal(db, {
    tenantId: "kund_a",
    proposalId: p1.id,
    outcome: "approved",
    decidedBy: "konsult@byran.se",
  });
  assert.equal(godkant.outcome, "approved");
  if (godkant.outcome === "approved") assert.ok(godkant.verifikation);

  const p2 = stor();
  await handleProposal(db, intern, p2);
  await assert.rejects(
    decideProposal(db, {
      tenantId: "kund_a",
      proposalId: p2.id,
      outcome: "rejected",
      decidedBy: "konsult@byran.se",
    }),
    /motivering/,
  );
  const avvisat = await decideProposal(db, {
    tenantId: "kund_a",
    proposalId: p2.id,
    outcome: "rejected",
    decidedBy: "konsult@byran.se",
    reason: "Fel motpart på underlaget",
  });
  assert.equal(avvisat.outcome, "rejected");

  // Redan beslutat förslag kan inte beslutas igen.
  await assert.rejects(
    decideProposal(db, {
      tenantId: "kund_a",
      proposalId: p1.id,
      outcome: "approved",
      decidedBy: "konsult@byran.se",
    }),
    /redan/,
  );
});

test("payload manipulerad i databasen efter POST → beslutet vägras", async () => {
  const p = exempelProposal({
    lines: [
      { konto: "4010", benamning: "Stort inköp", debet_ore: 800_000, kredit_ore: 0 },
      { konto: "2440", benamning: "Leverantörsskulder", debet_ore: 0, kredit_ore: 800_000 },
    ],
  });
  await handleProposal(db, intern, p);
  // Superuser-manipulation direkt i payload (RLS/grants gäller inte superuser
  // i testet — precis det scenario omräkningen ska fånga).
  const fusk = { ...p, summary: "Helt annat innehåll" };
  await db.query(`UPDATE proposals SET payload = $1 WHERE id = $2`, [
    JSON.stringify(fusk),
    p.id,
  ]);
  await assert.rejects(
    decideProposal(db, {
      tenantId: "kund_a",
      proposalId: p.id,
      outcome: "approved",
      decidedBy: "konsult@byran.se",
    }),
    /manipulerats/,
  );
});

test("kanda_motparter_endast: okänd motpart köas, känd auto-godkänns", async () => {
  await sparaPolicy(db, { ...oppenPolicy, kanda_motparter_endast: true });

  const okand = exempelProposal({ motpart: "Nya Leverantören AB" });
  const r1 = await handleProposal(db, intern, okand);
  assert.equal(r1.status, "pending");

  // "Kafferosteriet Exempel AB" är redan bokförd i tidigare tester → känd.
  const kand = exempelProposal();
  const r2 = await handleProposal(db, intern, kand);
  assert.equal(r2.status, "auto_approved");

  await sparaPolicy(db, oppenPolicy);
});

test("decisions är append-only: UPDATE nekas även för fel utanför app-rollen", async () => {
  await assert.rejects(
    db.query(`UPDATE decisions SET outcome = 'rejected'`),
    /får inte ändras/,
  );
});

test("advisory_answer: auto enligt radgivning-policyn, ingen ledger-effekt", async () => {
  const p = exempelProposal({
    module: "radgivning",
    kind: "advisory_answer",
    lines: [],
    motpart: undefined,
    summary: "Vilket konto används för ingående moms? — 2641, alla satser.",
    confidence: 0.8,
  });
  const r = await handleProposal(db, intern, p);
  assert.equal(r.status, "auto_approved");
  if (r.status !== "auto_approved") return;
  assert.equal(r.verifikation, null);
});
