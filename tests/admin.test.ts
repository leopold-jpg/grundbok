import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import {
  handleProposal,
  decideProposal,
  sparaPolicy,
  type Principal,
  type PolicyRad,
} from "../src/lib/decisions";
import { hamtaKo, hamtaBeslutslogg, hamtaPolicyer } from "../src/lib/admin";
import { exempelProposal } from "./helpers";
import { sha256Hex } from "../src/contracts";

// WP6: adminkonsolens dataassemblering — kön (med diff OMRÄKNAD mot
// gällande policy), beslutsloggen och policy-läsningen.

const db = await createDb();

const intern: Principal = {
  typ: "intern",
  tenant_id: "kund_a",
  module: "*",
  scopes: ["proposals:write"],
  namn: "test-admin",
};

// Öppen policy att växla till: max 5 000 kr, confidence ≥ 0.8,
// okända motparter OK, journal_entry tillåten.
const oppenPolicy: PolicyRad = {
  tenant_id: "kund_a",
  module: "bokforing",
  max_belopp_ore: 500_000,
  min_confidence: 0.8,
  kanda_motparter_endast: false,
  tillatna_kinds: ["journal_entry"],
};

const stortForslag = () =>
  exempelProposal({
    lines: [
      { konto: "4010", benamning: "Stort inköp", debet_ore: 600_000, kredit_ore: 0 },
      { konto: "2440", benamning: "Leverantörsskulder", debet_ore: 0, kredit_ore: 600_000 },
    ],
  });

// Behålls pending genom test 1–2 och godkänns i känd motpart-testet.
const forstaForslaget = exempelProposal();

test("hamtaKo: pending med omräknad diff — diffen följer GÄLLANDE policy", async () => {
  // Seedad bokforing-policy är helt manuell (max 0, min_conf 1, känd
  // motpart krävs, inga kinds) → exempelförslaget köas med 4 missade villkor.
  const r = await handleProposal(db, intern, forstaForslaget);
  assert.equal(r.status, "pending");

  let ko = await hamtaKo(db, "kund_a");
  let rad = ko.find((k) => k.id === forstaForslaget.id);
  assert.ok(rad, "förslaget ska ligga i kön");
  assert.equal(rad.summary, forstaForslaget.summary);
  assert.equal(rad.module, "bokforing");
  assert.equal(rad.kind, "journal_entry");
  assert.equal(rad.confidence, 0.9);
  assert.equal(rad.belopp_ore, 106_000);
  assert.equal(rad.hash, forstaForslaget.hash);
  assert.equal(rad.legal[0].lagrum, forstaForslaget.legal[0].lagrum);
  assert.match(rad.created_at, /^\d{4}-\d{2}-\d{2}T/, "created_at normaliseras till ISO");
  assert.equal(rad.missade_villkor.length, 4); // kind + confidence + belopp + motpart

  // Samma förslag, NY policy → NY diff. Omräkning, inte lagring.
  await sparaPolicy(db, oppenPolicy);
  ko = await hamtaKo(db, "kund_a");
  rad = ko.find((k) => k.id === forstaForslaget.id);
  assert.ok(rad);
  assert.equal(
    rad.missade_villkor.length,
    0,
    "mot den öppnade policyn ska diffen vara tom — förslaget väntar ändå på människa",
  );
});

test("hamtaKo: känd motpart-kollen räknas om via EXISTS i verifications", async () => {
  await sparaPolicy(db, { ...oppenPolicy, kanda_motparter_endast: true });

  const stor = stortForslag(); // pending oavsett: över max_belopp
  await handleProposal(db, intern, stor);

  // Ingen verifikation med motparten ännu → diffen innehåller motpartsvillkoret.
  let rad = (await hamtaKo(db, "kund_a")).find((k) => k.id === stor.id);
  assert.ok(rad);
  assert.ok(rad.missade_villkor.some((v) => v.includes("motpart")));
  assert.ok(rad.missade_villkor.some((v) => v.includes("belopp")));

  // Konsulten godkänner det första förslaget → motparten blir bokförd/känd
  // → samma köade förslag får ny, mindre diff vid nästa hämtning.
  const beslut = await decideProposal(db, {
    tenantId: "kund_a",
    proposalId: forstaForslaget.id,
    outcome: "approved",
    decidedBy: "konsult@byran.se",
  });
  assert.equal(beslut.outcome, "approved");

  rad = (await hamtaKo(db, "kund_a")).find((k) => k.id === stor.id);
  assert.ok(rad);
  assert.ok(!rad.missade_villkor.some((v) => v.includes("motpart")));
  assert.ok(rad.missade_villkor.some((v) => v.includes("belopp")));

  await sparaPolicy(db, oppenPolicy); // återställ
});

test("hamtaBeslutslogg: policy-beslut och mänskliga beslut, nyast först", async () => {
  // Auto-godkänt via policyn — med agent_runtime satt (OpenClaw-körning).
  const auto = exempelProposal({
    provenance: {
      model: "claude-opus-4-8",
      prompt_hash: sha256Hex("systemprompt+se/moms@1.0.0"),
      module_version: "0.2.0",
      agent_runtime: "openclaw@0.3",
      input_refs: [],
      injection_screened: true,
    },
  });
  const rAuto = await handleProposal(db, intern, auto);
  assert.equal(rAuto.status, "auto_approved");

  // Mänskligt avvisat med motivering.
  const stor = stortForslag();
  await handleProposal(db, intern, stor);
  await decideProposal(db, {
    tenantId: "kund_a",
    proposalId: stor.id,
    outcome: "rejected",
    decidedBy: "konsult@byran.se",
    reason: "Fel motpart på underlaget",
  });

  const logg = await hamtaBeslutslogg(db, "kund_a");

  const autoRad = logg.find((l) => l.proposal_id === auto.id);
  assert.ok(autoRad, "auto-beslutet ska synas i loggen");
  assert.equal(autoRad.outcome, "auto_approved");
  assert.equal(autoRad.decided_by, "policy:kund_a/bokforing");
  assert.equal(autoRad.model, "claude-opus-4-8");
  assert.equal(autoRad.agent_runtime, "openclaw@0.3");
  assert.ok((autoRad.verifikationsnummer ?? 0) >= 1);
  assert.match(autoRad.decided_at, /^\d{4}-\d{2}-\d{2}T/, "decided_at normaliseras till ISO");

  const avvisad = logg.find((l) => l.proposal_id === stor.id);
  assert.ok(avvisad, "det mänskliga beslutet ska synas i loggen");
  assert.equal(avvisad.outcome, "rejected");
  assert.equal(avvisad.decided_by, "konsult@byran.se");
  assert.equal(avvisad.reason, "Fel motpart på underlaget");
  assert.equal(avvisad.agent_runtime, null); // intern körning — inget runtime satt
  assert.equal(avvisad.verifikationsnummer, null);

  // Godkännandet från förra testet finns också — alla tre utfallen samlade.
  const godkand = logg.find((l) => l.proposal_id === forstaForslaget.id);
  assert.ok(godkand);
  assert.equal(godkand.outcome, "approved");
  assert.ok((godkand.verifikationsnummer ?? 0) >= 1);

  // Nyast först, och limit respekteras.
  const tider = logg.map((l) => l.decided_at);
  assert.deepEqual(tider, [...tider].sort((a, b) => b.localeCompare(a)));
  assert.equal((await hamtaBeslutslogg(db, "kund_a", 1)).length, 1);
});

test("hamtaPolicyer: returnerar tenantens policyer, tenant-scopat", async () => {
  const policyer = await hamtaPolicyer(db, "kund_a");
  const moduler = policyer.map((p) => p.module);
  assert.ok(moduler.includes("bokforing"));
  assert.ok(moduler.includes("radgivning"));

  // radgivning: orörd seed-default (läsande modul, auto för advisory_answer).
  const radgivning = policyer.find((p) => p.module === "radgivning");
  assert.ok(radgivning);
  assert.deepEqual(radgivning.tillatna_kinds, ["advisory_answer"]);
  assert.equal(radgivning.min_confidence, 0.5);
  assert.equal(radgivning.kanda_motparter_endast, false);

  // bokforing: den senast sparade (öppna) policyn — tal, inte strängar.
  const bokforing = policyer.find((p) => p.module === "bokforing");
  assert.ok(bokforing);
  assert.equal(bokforing.max_belopp_ore, 500_000);
  assert.equal(bokforing.min_confidence, 0.8);
  assert.deepEqual(bokforing.tillatna_kinds, ["journal_entry"]);

  // kund_b:s policyer är opåverkade av kund_a:s ändringar (RLS-scopning).
  const kundB = await hamtaPolicyer(db, "kund_b");
  const bBokforing = kundB.find((p) => p.module === "bokforing");
  assert.ok(bBokforing);
  assert.equal(bBokforing.max_belopp_ore, 0); // seed: helt manuell
  assert.equal(bBokforing.min_confidence, 1);
});
