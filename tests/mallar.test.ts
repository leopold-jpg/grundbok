// Golden-tester för mallregistret (WP11, ADR-0004 + ADR-0005). LLM:en
// "mockas" som i resten av sviten: GRUNDBOK_FORCE_FALLBACK tvingar den
// deterministiska tolkningen, så pipelinen mall → Proposal →
// kontraktvalidering är låst mot exakta facit. Fullt promptinnehåll per
// mall är nästa pass — dessa tester låser strukturen och stämpeln, inte
// prompttexterna.
//
// ADR-0005: mallar är FUNKTIONSROLLER; branschregler bor i BRANSCHPAKET
// aktiverade via tenant-kontexten. ROT-fallet testar paketet,
// kvittomatchning testar mallen — och kombinationen testas för de
// kombinationer som har verkliga tenants (bygg, cafe), inte alla
// teoretiska.
process.env.GRUNDBOK_FORCE_FALLBACK = "1";

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  BRANSCHPAKET_IDS,
  mallRegistret,
  branschpaketRegistret,
  hamtaMall,
  mallMajor,
  hamtaMallForMajor,
  paketForTenantMall,
  aktivaBranschpaket,
  effektivaRegler,
  type MallDefinition,
} from "../src/mallar/registry";
import { tolka } from "../src/lib/extract";
import { kontera, type Forslag } from "../src/lib/kontering";
import { byggBokforingsProposal, bokforingsKonfidens } from "../src/lib/bokforing-modul";
import { evaluateAutonomy, type PolicyRad } from "../src/lib/decisions";
import { kaffefaktura, BYGGFAKTURA } from "../src/lib/exempel";
import { exempelProposal } from "./helpers";

/** Bokföringsrollernas pipeline: underlagstext → tolka (fallback) →
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

test("registret: fyra funktionsroller i release ett, korrekt struktur", () => {
  assert.deepEqual(
    [...MALL_IDS].sort(),
    ["bokforing", "leverantorsreskontra", "lon", "skatt-compliance"],
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
    // Deklarerade paket måste finnas i paketregistret.
    for (const paket of mall.branschpaket ?? []) {
      assert.ok((BRANSCHPAKET_IDS as readonly string[]).includes(paket));
    }
    const p = mall.defaultPolicy;
    assert.ok(Number.isInteger(p.max_belopp_ore) && p.max_belopp_ore >= 0);
    assert.ok(p.min_confidence >= 0 && p.min_confidence <= 1);
    for (const kind of p.tillatna_kinds) {
      assert.ok((PROPOSAL_KINDS as readonly string[]).includes(kind));
    }
  }
  // Skatterollen är compliance-avgränsad och lönen batchad — ingen av dem
  // auto-godkänner något i release ett.
  assert.deepEqual(mallRegistret["skatt-compliance"].defaultPolicy.tillatna_kinds, []);
  assert.deepEqual(mallRegistret.lon.defaultPolicy.tillatna_kinds, []);
});

// ===================================================== systempromptar (WP30)

test("WP30: stubbarna är ersatta — fullständiga promptar, minor-bumpade till 1.1", () => {
  for (const id of MALL_IDS) {
    const mall = mallRegistret[id];
    assert.ok(!mall.systemPrompt.includes("STUB"), `${id} bär kvar stub-prompten`);
    assert.ok(mall.systemPrompt.length > 1000, `${id}: prompten är för tunn för att vara fullständig`);
    assert.equal(mallMajor(mall.version), "1", `${id}: minor-bump får inte byta major`);
    assert.ok(
      mall.version.startsWith("1.1."),
      `${id}: promptversionering kräver minor-bump (är ${mall.version})`,
    );
  }
});

test("WP30: varje prompt bär den obligatoriska granskningsordningen", () => {
  for (const id of MALL_IDS) {
    const prompt = mallRegistret[id].systemPrompt;
    // Mottagarkontrollen FÖRST — fel mottagare ger flagga och ingen kontering.
    assert.ok(prompt.includes("MOTTAGARKONTROLL FÖRST"), `${id}: mottagarkontroll saknas`);
    assert.ok(prompt.includes("flag_wrong_tenant"), `${id}: flag_wrong_tenant saknas`);
    assert.ok(prompt.includes("INGEN kontering"), `${id}: 'ingen kontering' saknas`);
    // Privat/verksamhetsfrämmande.
    assert.ok(prompt.includes("flag_private_expense"), `${id}: flag_private_expense saknas`);
    // Delmatchning med restbelopp.
    assert.ok(prompt.includes("missing_receipt"), `${id}: missing_receipt saknas`);
    assert.ok(prompt.includes("restbelopp"), `${id}: restbelopp saknas`);
    // Dubblettdetektering leverantör+belopp+period.
    assert.ok(prompt.includes("dubblett_misstankt"), `${id}: dubblettdetektering saknas`);
    // Förskott ≠ kostnad → 1480.
    assert.ok(prompt.includes("1480"), `${id}: förskottskontot 1480 saknas`);
    // Beloppsanomali — telemetrisignal.
    assert.ok(prompt.includes("anomaly_amount"), `${id}: anomaly_amount saknas`);
    // Output alltid kontraktet v0.3, med eskaleringsregler.
    assert.ok(prompt.includes("Proposal enligt kontraktet v0.3"), `${id}: kontraktskravet saknas`);
    assert.ok(prompt.includes("ESKALERINGSREGLER"), `${id}: eskaleringsregler saknas`);
  }
});

test("WP30: rollspecifika gränser bor i respektive prompt", () => {
  const p = mallRegistret;
  // Bokföring: kvittomatchning/periodisering + aldrig rådgivning.
  assert.ok(p.bokforing.systemPrompt.includes("kvittomatchning"));
  // Lön: batch, aldrig auto, personuppgiftsdisciplin.
  assert.ok(p.lon.systemPrompt.includes("payroll_run"));
  assert.ok(p.lon.systemPrompt.includes("auto-godkänns ALDRIG"));
  assert.ok(p.lon.systemPrompt.includes("aldrig namn eller personnummer"));
  // Skatt: compliance-avgränsning (ADR-0005), ingen rådgivning.
  assert.ok(p["skatt-compliance"].systemPrompt.includes("COMPLIANCE"));
  assert.ok(p["skatt-compliance"].systemPrompt.includes("aldrig rådgivning"));
  // Reskontra: betalningar verkställs aldrig, fakturakapningsvakt.
  assert.ok(p.leverantorsreskontra.systemPrompt.includes("verkställs ALDRIG"));
  assert.ok(p.leverantorsreskontra.systemPrompt.includes("fakturakapning"));
});

test("registret: uppslagning, major-pekare och versionsdrift", () => {
  assert.equal(hamtaMall("bokforing")?.displayName, "Bokföring");
  // Branschmallarna från före ADR-0005 har lämnat katalogen — uppslag på
  // dem är versionsdrift-vägen, aldrig ett undantag.
  assert.equal(hamtaMall("bokforing-bygg"), null);
  assert.equal(hamtaMall("finns-inte"), null);
  assert.equal(mallMajor("1.2.3"), "1");
  assert.equal(hamtaMallForMajor("leverantorsreskontra", "1")?.version, "1.1.0");
  assert.equal(hamtaMallForMajor("leverantorsreskontra", "2"), null);
  assert.equal(hamtaMallForMajor("finns-inte", "1"), null);
});

// ========================================================== branschpaket

test("branschpaket: bygg och restaurang, regler med hemvist ENDAST i paketet", () => {
  assert.deepEqual([...BRANSCHPAKET_IDS].sort(), ["bygg", "restaurang"]);
  for (const id of BRANSCHPAKET_IDS) {
    const paket = branschpaketRegistret[id];
    assert.equal(paket.id, id);
    assert.match(paket.version, /^\d+\.\d+\.\d+$/);
    assert.ok(paket.regler.length >= 1);
  }
  // Bygg-reglerna flyttade UR bygg-stubben (ADR-0005): omvänd byggmoms +
  // ROT bor i paketet, med lagrum.
  const bygg = branschpaketRegistret.bygg.regler;
  assert.ok(bygg.some((r) => r.id === "omvand-byggmoms"));
  assert.ok(bygg.some((r) => r.id === "rot-avdrag"));
  for (const r of bygg) assert.ok(r.lagrum && r.lagrum.length > 0);

  // Regel-hemvist (tumregeln): en paketregel får inte samtidigt ligga i
  // någon funktionsmall — då hade den gällt fler branscher och hört hemma
  // i mallen.
  const paketRegelIds = new Set(
    Object.values(branschpaketRegistret).flatMap((p) => p.regler.map((r) => r.id)),
  );
  for (const mall of Object.values(mallRegistret)) {
    for (const regel of mall.regler) {
      assert.ok(!paketRegelIds.has(regel.id), `${regel.id} bor i både mall och paket`);
    }
  }
});

test("branschpaket: varje branschmall i kundkatalogen har ett EXPLICIT paketbeslut", () => {
  // Driftvakt (granskningsfynd): paketForTenantMall faller tyst till []
  // för okända branschmallar. Det är rätt runtime-beteende, men en NY
  // branschmall i customers/mallar/ får inte glida förbi utan att någon
  // tagit ställning till dess paket — en mall 'restaurang' som glöms i
  // mappningen hade tyst aktiverat ingenting. Ny mall ⇒ uppdatera facit.
  const katalog = readdirSync(join(process.cwd(), "customers", "mallar"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const config = JSON.parse(
        readFileSync(join(process.cwd(), "customers", "mallar", f), "utf8"),
      ) as { mall_id: string };
      return config.mall_id;
    })
    .sort();
  const facit: Record<string, string[]> = {
    bygg: ["bygg"],
    cafe: ["restaurang"],
    konsultbyra: [], // medvetet paketlös — konsultregler bor i funktionsmallen
  };
  assert.deepEqual(katalog, Object.keys(facit).sort());
  for (const [tenantMall, paket] of Object.entries(facit)) {
    assert.deepEqual(paketForTenantMall(tenantMall), paket);
  }
});

test("branschpaket: tenant-kontexten aktiverar — bygg→bygg, cafe→restaurang, okänd→inga", () => {
  assert.deepEqual(paketForTenantMall("bygg"), ["bygg"]);
  assert.deepEqual(paketForTenantMall("cafe"), ["restaurang"]);
  assert.deepEqual(paketForTenantMall("konsultbyra"), []);
  assert.deepEqual(paketForTenantMall("helt-okand"), []);

  const bokforing = mallRegistret.bokforing;
  // Snittet mall × tenant: bokföringsrollen hos byggtenant får bygg-paketet…
  assert.deepEqual(
    aktivaBranschpaket(bokforing, "bygg").map((p) => p.id),
    ["bygg"],
  );
  // …och en branschneutral roll (lon) aktiverar inget alls, oavsett tenant.
  assert.deepEqual(aktivaBranschpaket(mallRegistret.lon, "bygg"), []);
});

test("branschpaket: effektiva regler = mallens + aktiva paketens, utan id-kollisioner", () => {
  const bokforing = mallRegistret.bokforing;
  const hosBygg = effektivaRegler(bokforing, "bygg").map((r) => r.id);
  // Funktionsreglerna följer med till ALLA branscher…
  assert.ok(hosBygg.includes("kvittomatchning"));
  // …och byggpaketets regler läggs till hos byggtenanten…
  assert.ok(hosBygg.includes("omvand-byggmoms") && hosBygg.includes("rot-avdrag"));
  // …men aldrig restaurangens.
  assert.ok(!hosBygg.includes("livsmedelsmoms"));

  const hosKonsult = effektivaRegler(bokforing, "konsultbyra").map((r) => r.id);
  assert.ok(hosKonsult.includes("kvittomatchning"));
  assert.ok(!hosKonsult.includes("omvand-byggmoms"));

  // Inga dubbla regel-id:n i någon verklig kombination.
  for (const tenantMall of ["bygg", "cafe", "konsultbyra"]) {
    for (const mall of Object.values(mallRegistret)) {
      const ids = effektivaRegler(mall, tenantMall).map((r) => r.id);
      assert.equal(new Set(ids).size, ids.length, `${mall.id}×${tenantMall} har regelkollision`);
    }
  }
});

// ============================================ bokforing × branschpaket bygg

test("golden bokforing×bygg: BYGGFAKTURA → omvänd byggmoms-form, stämplad bokforing@1.1.0", async () => {
  const mall = mallRegistret.bokforing;
  const { proposal } = await byggViaMall(mall, BYGGFAKTURA, "kund_b");
  // Samma facit som kontering.test.ts (ML 16 kap. 13 §): säljaren
  // fakturerar utan moms, köparen redovisar ut- OCH ingående. OBS:
  // runtime-konteringen styrs i release ett av kundconfigens omvand_bygg
  // (bestamMoms) — branschpaketet 'bygg' bär regelDOKUMENTATIONEN och
  // vävs in i LLM-vägen först när prompterna fylls (nästa pass). Testet
  // låser pipelinens facit + stämpeln, inte att paketet driver logiken.
  assert.deepEqual(tuples(proposal), [
    ["4425", 1_000_000, 0],
    ["2440", 0, 1_000_000],
    ["2614", 0, 250_000],
    ["2647", 250_000, 0],
  ]);
  assert.equal(proposal.mall_id, "bokforing");
  assert.equal(proposal.mall_version, "1.1.0");
  assert.equal(proposal.module, "bokforing");
  valideraKontrakt(proposal);
});

// ============================================ bokforing × branschpaket resto

test("golden bokforing×restaurang: kaffefaktura juli (6 %) → 4010/2641/2440, stämplad", async () => {
  const mall = mallRegistret.bokforing;
  const { proposal, forslag } = await byggViaMall(mall, kaffefaktura("2026-07-08", 6), "kund_a");
  assert.deepEqual(tuples(proposal), [
    ["4010", 100_000, 0],
    ["2641", 6_000, 0],
    ["2440", 0, 106_000],
  ]);
  assert.equal(proposal.mall_id, "bokforing");
  assert.equal(proposal.mall_version, "1.1.0");
  assert.equal(proposal.confidence, bokforingsKonfidens("fallback", forslag));
  valideraKontrakt(proposal);
});

test("golden bokforing×restaurang: mars-faktura (12 %) → regelversioneringen följer med", async () => {
  const mall = mallRegistret.bokforing;
  const { proposal } = await byggViaMall(mall, kaffefaktura("2026-03-15", 12), "kund_a");
  assert.deepEqual(tuples(proposal), [
    ["4010", 100_000, 0],
    ["2641", 12_000, 0],
    ["2440", 0, 112_000],
  ]);
  assert.equal(proposal.mall_version, "1.1.0");
  valideraKontrakt(proposal);
});

// ==================================================== bokforing: policy

test("golden bokforing: fallback-konfidens går till kön, hög konfidens auto-bokförs", async () => {
  const mall = mallRegistret.bokforing;
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

test("golden bokforing: agentens major-pekare löser mot registrets 1.x.y", () => {
  const mall = mallRegistret.bokforing;
  assert.equal(mallMajor(mall.version), "1");
  assert.equal(hamtaMallForMajor(mall.id, mallMajor(mall.version)), mall);
});

// ====================================================== leverantorsreskontra

test("golden reskontra: kaffefaktura genom reskontrarollen, stämplad leverantorsreskontra@1.1.0", async () => {
  const mall = mallRegistret.leverantorsreskontra;
  const { proposal } = await byggViaMall(mall, kaffefaktura("2026-07-08", 6), "kund_a");
  assert.deepEqual(tuples(proposal), [
    ["4010", 100_000, 0],
    ["2641", 6_000, 0],
    ["2440", 0, 106_000],
  ]);
  assert.equal(proposal.mall_id, "leverantorsreskontra");
  assert.equal(proposal.mall_version, "1.1.0");
  valideraKontrakt(proposal);
});

test("golden reskontra: beloppsgränsen 1 000 kr är enda hindret vid hög konfidens", async () => {
  const mall = mallRegistret.leverantorsreskontra;
  const { proposal } = await byggViaMall(mall, kaffefaktura("2026-07-08", 6), "kund_a");
  // 1 060 kr > 1 000 kr-gränsen — allt annat passerar.
  const utfall = evaluateAutonomy({ ...proposal, confidence: 0.95 }, policyRad(mall), true);
  assert.equal(utfall.auto, false);
  assert.equal(utfall.missade.length, 1);
  assert.ok(utfall.missade[0].includes("belopp"));
});

test("golden reskontra: mottagarkontroll och dubblettdetektering bor i rollen", () => {
  const regler = mallRegistret.leverantorsreskontra.regler.map((r) => r.id);
  assert.ok(regler.includes("mottagarkontroll"));
  assert.ok(regler.includes("dubblettdetektering"));
  // Byggpaketet är deklarerat: omvänd byggmoms gäller även reskontran
  // hos en byggtenant.
  assert.deepEqual(
    aktivaBranschpaket(mallRegistret.leverantorsreskontra, "bygg").map((p) => p.id),
    ["bygg"],
  );
});

// ======================================================= skatt-compliance

test("golden skatt-compliance: compliance-avgränsad roll som aldrig auto-godkänner", async () => {
  const mall = mallRegistret["skatt-compliance"];
  assert.equal(mall.module, "skatt-juridik");
  const regler = mall.regler.map((r) => r.id);
  assert.ok(regler.includes("momsdeklaration-avstamning"));
  assert.ok(regler.includes("deklarationsfrister"));
  // Ingen rådgivning i release ett (ADR-0005) — och ingen autonomi:
  // även perfekt konfidens och känd motpart attesteras.
  const { proposal } = await byggViaMall(mallRegistret.bokforing, BYGGFAKTURA, "kund_b");
  const utfall = evaluateAutonomy({ ...proposal, confidence: 1 }, policyRad(mall, "kund_b"), true);
  assert.equal(utfall.auto, false);
  assert.ok(utfall.missade.some((v) => v.includes("tillåtna kinds")));
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

test("golden lon: payroll_run-batch stämplad lon@1.1.0 validerar och balanserar", () => {
  const proposal = lonProposal();
  assert.equal(proposal.mall_id, "lon");
  assert.equal(proposal.mall_version, "1.1.0");
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
  const mall = mallRegistret.bokforing;
  const { proposal } = await byggViaMall(mall, BYGGFAKTURA, "kund_b");
  const parsed = ProposalSchema.parse(proposal);
  assert.equal(parsed.mall_id, "bokforing");
  assert.equal(hashProposal(parsed as Proposal), proposal.hash);
});

test("v0.3: historisk stämpel från en mall som lämnat katalogen validerar", () => {
  // Kontraktet äger inte katalogen: förslag stämplade med branschmallarna
  // från före ADR-0005 är giltig historik, aldrig ett valideringsfel.
  const historisk = exempelProposal({
    contract_version: "0.3.0",
    mall_id: "bokforing-restaurang",
    mall_version: "1.0.0",
  });
  assert.ok(ProposalSchema.safeParse(historisk).success);
  assert.equal(hamtaMall("bokforing-restaurang"), null);
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
    mall_id: "bokforing",
    mall_version: "1",
  });
  assert.equal(ProposalSchema.safeParse(trasig).success, false);
});
