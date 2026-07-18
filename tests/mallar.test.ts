// Golden-tester för mallregistret (WP11, ADR-0004). LLM:en "mockas" som i
// resten av sviten: GRUNDBOK_FORCE_FALLBACK tvingar den deterministiska
// tolkningen, så pipelinen mall → Proposal → kontraktvalidering är låst
// mot exakta facit. Fullt promptinnehåll per mall är nästa pass — dessa
// tester låser strukturen och stämpeln, inte prompttexterna.
process.env.GRUNDBOK_FORCE_FALLBACK = "1";

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ProposalSchema,
  hashProposal,
  verifyProposalHash,
  MODULE_IDS,
  PROPOSAL_KINDS,
  type Proposal,
} from "../src/contracts";
import {
  MALL_IDS,
  mallRegistret,
  hamtaMall,
  mallMajor,
  hamtaMallForMajor,
  type MallDefinition,
} from "../src/mallar/registry";
import { tolka } from "../src/lib/extract";
import { kontera, type Forslag } from "../src/lib/kontering";
import { byggBokforingsProposal, bokforingsKonfidens } from "../src/lib/bokforing-modul";
import { evaluateAutonomy, type PolicyRad } from "../src/lib/decisions";
import { kaffefaktura, BYGGFAKTURA } from "../src/lib/exempel";
import { exempelProposal } from "./helpers";

/** Bokföringsmallarnas pipeline: underlagstext → tolka (fallback) →
 *  kontera → byggBokforingsProposal med mallstämpel. Ingen DB behövs —
 *  dokumentreferensen är en fri uuid i input_refs. */
async function byggViaMall(
  mall: MallDefinition,
  underlag: string,
  tenantId: string,
): Promise<{ proposal: Proposal; forslag: Forslag }> {
  const tolkning = await tolka(underlag);
  const forslag = kontera(tolkning.extraktion, tenantId);
  const proposal = byggBokforingsProposal({
    tenantId,
    documentId: randomUUID(),
    extraktion: tolkning.extraktion,
    forslag,
    motor: tolkning.motor,
    motorDetalj: tolkning.motor_detalj,
    mall: { id: mall.id, version: mall.version },
  });
  return { proposal, forslag };
}

function policyRad(mall: MallDefinition, tenantId = "kund_a"): PolicyRad {
  return { tenant_id: tenantId, module: mall.module, ...mall.defaultPolicy };
}

function tuples(p: Proposal): [string, number, number][] {
  return p.lines.map((l) => [l.konto, l.debet_ore, l.kredit_ore]);
}

/** Kontraktvalidering + hashverifiering — grinden varje golden går genom. */
function valideraKontrakt(p: Proposal): void {
  const parsed = ProposalSchema.safeParse(p);
  assert.ok(
    parsed.success,
    `kontraktet avvisade förslaget: ${JSON.stringify(parsed.success ? [] : parsed.error.issues)}`,
  );
  assert.ok(verifyProposalHash(p));
}

// ================================================================ registret

test("registret: fyra mallar i release ett, korrekt struktur", () => {
  assert.deepEqual(
    [...MALL_IDS].sort(),
    ["bokforing-bygg", "bokforing-konsult", "bokforing-restaurang", "lon"],
  );
  for (const id of MALL_IDS) {
    const mall = mallRegistret[id];
    assert.equal(mall.id, id);
    assert.ok((MODULE_IDS as readonly string[]).includes(mall.module));
    assert.match(mall.version, /^\d+\.\d+\.\d+$/);
    assert.ok(mall.displayName.length > 0);
    assert.ok(mall.systemPrompt.length > 0);
    assert.ok(mall.regler.length >= 2);
    for (const regel of mall.regler) {
      assert.ok(regel.id.length > 0 && regel.beskrivning.length > 0);
    }
    const p = mall.defaultPolicy;
    assert.ok(Number.isInteger(p.max_belopp_ore) && p.max_belopp_ore >= 0);
    assert.ok(p.min_confidence >= 0 && p.min_confidence <= 1);
    for (const kind of p.tillatna_kinds) {
      assert.ok((PROPOSAL_KINDS as readonly string[]).includes(kind));
    }
  }
});

test("registret: uppslagning, major-pekare och versionsdrift", () => {
  assert.equal(hamtaMall("bokforing-bygg")?.displayName, "Bokföring — bygg");
  assert.equal(hamtaMall("finns-inte"), null);
  assert.equal(mallMajor("1.2.3"), "1");
  // Agentens pekare är major — registrets aktuella 1.x.y matchar "1",
  // en borttagen major är drift och ska ge null, aldrig en tyst träff.
  assert.equal(hamtaMallForMajor("bokforing-konsult", "1")?.version, "1.0.0");
  assert.equal(hamtaMallForMajor("bokforing-konsult", "2"), null);
  assert.equal(hamtaMallForMajor("finns-inte", "1"), null);
});

// ========================================================== bokforing-bygg

test("golden bygg: BYGGFAKTURA → omvänd byggmoms-form, stämplad bygg@1.0.0", async () => {
  const mall = mallRegistret["bokforing-bygg"];
  const { proposal } = await byggViaMall(mall, BYGGFAKTURA, "kund_b");
  // Samma facit som kontering.test.ts (ML 16 kap. 13 §): säljaren
  // fakturerar utan moms, köparen redovisar ut- OCH ingående.
  assert.deepEqual(tuples(proposal), [
    ["4425", 1_000_000, 0],
    ["2440", 0, 1_000_000],
    ["2614", 0, 250_000],
    ["2647", 250_000, 0],
  ]);
  assert.equal(proposal.mall_id, "bokforing-bygg");
  assert.equal(proposal.mall_version, "1.0.0");
  assert.equal(proposal.module, "bokforing");
  valideraKontrakt(proposal);
});

test("golden bygg: mallens policy auto-godkänner aldrig — allt attesteras", async () => {
  const mall = mallRegistret["bokforing-bygg"];
  const { proposal } = await byggViaMall(mall, BYGGFAKTURA, "kund_b");
  // Även perfekt konfidens och känd motpart: tillatna_kinds är tom.
  const utfall = evaluateAutonomy({ ...proposal, confidence: 1 }, policyRad(mall, "kund_b"), true);
  assert.equal(utfall.auto, false);
  assert.ok(utfall.missade.some((v) => v.includes("tillåtna kinds")));
});

test("golden bygg: reglerna omvänd byggmoms + ROT finns med lagrum", () => {
  const regler = mallRegistret["bokforing-bygg"].regler.map((r) => r.id);
  assert.ok(regler.includes("omvand-byggmoms"));
  assert.ok(regler.includes("rot-avdrag"));
  for (const r of mallRegistret["bokforing-bygg"].regler) {
    assert.ok(r.lagrum && r.lagrum.length > 0);
  }
});

// ==================================================== bokforing-restaurang

test("golden restaurang: kaffefaktura juli (6 %) → 4010/2641/2440, stämplad", async () => {
  const mall = mallRegistret["bokforing-restaurang"];
  const { proposal, forslag } = await byggViaMall(mall, kaffefaktura("2026-07-08", 6), "kund_a");
  assert.deepEqual(tuples(proposal), [
    ["4010", 100_000, 0],
    ["2641", 6_000, 0],
    ["2440", 0, 106_000],
  ]);
  assert.equal(proposal.mall_id, "bokforing-restaurang");
  assert.equal(proposal.mall_version, "1.0.0");
  assert.equal(proposal.confidence, bokforingsKonfidens("fallback", forslag));
  valideraKontrakt(proposal);
});

test("golden restaurang: mars-faktura (12 %) → regelversioneringen följer med genom mallen", async () => {
  const mall = mallRegistret["bokforing-restaurang"];
  const { proposal } = await byggViaMall(mall, kaffefaktura("2026-03-15", 12), "kund_a");
  assert.deepEqual(tuples(proposal), [
    ["4010", 100_000, 0],
    ["2641", 12_000, 0],
    ["2440", 0, 112_000],
  ]);
  assert.equal(proposal.mall_version, "1.0.0");
  valideraKontrakt(proposal);
});

test("golden restaurang: fallback-konfidens går till kön, hög konfidens auto-bokförs", async () => {
  const mall = mallRegistret["bokforing-restaurang"];
  const { proposal } = await byggViaMall(mall, kaffefaktura("2026-07-08", 6), "kund_a");
  // Fallback-motorns 0.7 når inte policyns 0.85 — förslaget köas.
  const forsiktigt = evaluateAutonomy(proposal, policyRad(mall), true);
  assert.equal(forsiktigt.auto, false);
  assert.ok(forsiktigt.missade.some((v) => v.includes("confidence")));
  // Samma förslag med LLM-klassens konfidens: under gränsen 2 000 kr,
  // känd motpart, tillåten kind → auto.
  const säkert = evaluateAutonomy({ ...proposal, confidence: 0.9 }, policyRad(mall), true);
  assert.equal(säkert.auto, true);
  assert.deepEqual(säkert.missade, []);
});

// ======================================================= bokforing-konsult

test("golden konsult: kaffefaktura genom konsultmallen, stämplad konsult@1.0.0", async () => {
  const mall = mallRegistret["bokforing-konsult"];
  const { proposal } = await byggViaMall(mall, kaffefaktura("2026-07-08", 6), "kund_a");
  assert.deepEqual(tuples(proposal), [
    ["4010", 100_000, 0],
    ["2641", 6_000, 0],
    ["2440", 0, 106_000],
  ]);
  assert.equal(proposal.mall_id, "bokforing-konsult");
  assert.equal(proposal.mall_version, "1.0.0");
  valideraKontrakt(proposal);
});

test("golden konsult: beloppsgränsen 1 000 kr är enda hindret vid hög konfidens", async () => {
  const mall = mallRegistret["bokforing-konsult"];
  const { proposal } = await byggViaMall(mall, kaffefaktura("2026-07-08", 6), "kund_a");
  // 1 060 kr > 1 000 kr-gränsen — allt annat passerar.
  const utfall = evaluateAutonomy({ ...proposal, confidence: 0.95 }, policyRad(mall), true);
  assert.equal(utfall.auto, false);
  assert.equal(utfall.missade.length, 1);
  assert.ok(utfall.missade[0].includes("belopp"));
});

test("golden konsult: agentens major-pekare löser mot registrets 1.x.y", () => {
  const mall = mallRegistret["bokforing-konsult"];
  assert.equal(mallMajor(mall.version), "1");
  assert.equal(hamtaMallForMajor(mall.id, mallMajor(mall.version)), mall);
});

// ===================================================================== lon

/** Lönemodulen saknar runtime i release ett — "LLM-svaret" är literal
 *  (samma mönster som bokforing-flode.test.ts:s Extraktion-literal).
 *  Byggs utan exempelProposal: en explicit-undefined motpart-nyckel skulle
 *  glida genom canonicalJson. Poängen är att stämpel + kontraktsform för
 *  payroll_run är låst. */
function lonProposal(overrides: Partial<Proposal> = {}): Proposal {
  const utanHash: Omit<Proposal, "hash"> = {
    contract_version: "0.3.0",
    id: randomUUID(),
    tenant_id: "kund_a",
    module: "loner",
    kind: "payroll_run",
    batch_id: "lonekorning-2026-07",
    mall_id: "lon",
    mall_version: mallRegistret.lon.version,
    affarshandelsedatum: "2026-07-25",
    summary: "Lönekörning juli 2026 — 1 anställd",
    lines: [
      { konto: "7010", benamning: "Löner till kollektivanställda", debet_ore: 3_000_000, kredit_ore: 0 },
      { konto: "7510", benamning: "Lagstadgade sociala avgifter", debet_ore: 942_600, kredit_ore: 0 },
      { konto: "2710", benamning: "Personalskatt", debet_ore: 0, kredit_ore: 900_000 },
      { konto: "2731", benamning: "Avräkning lagstadgade sociala avgifter", debet_ore: 0, kredit_ore: 942_600 },
      { konto: "1930", benamning: "Företagskonto", debet_ore: 0, kredit_ore: 2_100_000 },
    ],
    legal: [{ lagrum: "SFL (2011:1244) 26 kap.", ruleset: "se/lon@0.0.1" }],
    confidence: 0.9,
    provenance: {
      model: "fallback:deterministisk",
      prompt_hash: "0".repeat(64),
      module_version: "0.0.1",
      input_refs: [`document:${randomUUID()}`],
      injection_screened: true,
    },
  };
  const sammanslagen = { ...utanHash, ...overrides };
  const { hash: _bort, ...utan } = sammanslagen as Proposal;
  return { ...utan, hash: overrides.hash ?? hashProposal(utan) } as Proposal;
}

test("golden lon: payroll_run-batch stämplad lon@1.0.0 validerar och balanserar", () => {
  const proposal = lonProposal();
  assert.equal(proposal.mall_id, "lon");
  assert.equal(proposal.mall_version, "1.0.0");
  assert.equal(mallRegistret.lon.module, "loner");
  valideraKontrakt(proposal);
  const debet = proposal.lines.reduce((s, l) => s + l.debet_ore, 0);
  const kredit = proposal.lines.reduce((s, l) => s + l.kredit_ore, 0);
  assert.equal(debet, kredit);
  assert.ok(proposal.batch_id);
});

test("golden lon: lönemallens policy auto-godkänner aldrig en lönekörning", () => {
  const proposal = lonProposal();
  const utfall = evaluateAutonomy(
    { ...proposal, confidence: 1 },
    policyRad(mallRegistret.lon),
    true,
  );
  assert.equal(utfall.auto, false);
  assert.ok(utfall.missade.some((v) => v.includes("tillåtna kinds")));
});

test("golden lon: obalanserad lönekörning avvisas av kontraktet", () => {
  const trasig = lonProposal({
    lines: [
      { konto: "7010", benamning: "Löner", debet_ore: 3_000_000, kredit_ore: 0 },
      { konto: "1930", benamning: "Företagskonto", debet_ore: 0, kredit_ore: 2_999_900 },
    ],
  });
  const parsed = ProposalSchema.safeParse(trasig);
  assert.equal(parsed.success, false);
});

// ==================================================== kontraktet v0.3

test("v0.3: v0.2-avsändare utan stämpel validerar oförändrat", () => {
  const gammal = exempelProposal(); // contract_version 0.2.0, ingen stämpel
  assert.equal(gammal.contract_version, "0.2.0");
  const parsed = ProposalSchema.safeParse(gammal);
  assert.ok(parsed.success);
});

test("v0.3: zod strippar inte stämpeln — omhashad parsed payload är identisk", async () => {
  // Regressionsvakt för kontraktets farligaste fälla: handleProposal
  // hashar om parsed.data, så ett fält som saknas i zod-schemat strippas
  // tyst och fäller hashverifieringen vid porten.
  const mall = mallRegistret["bokforing-bygg"];
  const { proposal } = await byggViaMall(mall, BYGGFAKTURA, "kund_b");
  const parsed = ProposalSchema.parse(proposal);
  assert.equal(parsed.mall_id, "bokforing-bygg");
  assert.equal(hashProposal(parsed as Proposal), proposal.hash);
});

test("v0.3: ensam stämpelhalva avvisas — mall_id och mall_version i par", () => {
  const utanVersion = exempelProposal({ contract_version: "0.3.0", mall_id: "lon" });
  const parsed = ProposalSchema.safeParse(utanVersion);
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.ok(parsed.error.issues.some((i) => i.message.includes("i par")));
  }
});

test("v0.3: mall_version måste vara exakt semver, inte major-pekaren", () => {
  const trasig = exempelProposal({
    contract_version: "0.3.0",
    mall_id: "bokforing-bygg",
    mall_version: "1",
  });
  assert.equal(ProposalSchema.safeParse(trasig).success, false);
});
