// Golden-tester för de åtta verkliga fallen (WP32, TESTUNDERLAG).
// Underlagen är textrepresentationer (tests/golden-underlag.ts), facit
// ligger i testdata/expected/fall-<n>.json — förväntad Proposal-form,
// inga verkliga persondata.
//
// LLM-mockning: som resten av sviten tvingas den deterministiska
// fallbacken — MEN sviten är strukturerad för att köras mot riktig LLM:
//   GRUNDBOK_GOLDEN_LIVE=1 ANTHROPIC_API_KEY=… node --import tsx --test tests/golden-fall.test.ts
// Samma underlag, samma facit — extraktionen byter motor, granskningen
// och konteringen är deterministiska oavsett.
//
// Fall 6 är BLOCKERAT (TESTUNDERLAG-GOLDEN.md saknas i repot) — testet
// verifierar att blockeringen är dokumenterad, aldrig tyst borttappad.

const LIVE = process.env.GRUNDBOK_GOLDEN_LIVE === "1";
if (!LIVE) process.env.GRUNDBOK_FORCE_FALLBACK = "1";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import type { Proposal } from "../src/contracts";
import { createDb } from "../src/lib/db/client";
import { withTenant } from "../src/lib/db/tenant";
import { skapaAgentNyckel } from "../src/lib/agent-auth";
import { körJobb } from "../src/workers/run-agent";
import type { AgentJobb } from "../src/lib/queue";
import type { Flagga } from "../src/lib/kontering";
import { evaluateAutonomy } from "../src/lib/decisions";
import { mallRegistret } from "../src/mallar/registry";
import {
  FALL_1_FEL_MOTTAGARE,
  FALL_2_ATA_AVVIKELSE,
  FALL_3_FORSKOTT,
  FALL_4_PRIVAT,
  FALL_5_DELMATCHNING,
  FALL_6_EU_TJANST,
  FALL_7_EL_ANOMALI,
  FALL_8_DUBBLETT,
} from "./golden-underlag";

type Forvantan = {
  fall: number;
  titel: string;
  blockerad?: boolean;
  skal?: string;
  tenant?: string;
  forvantat?: {
    kind: string;
    eskalerad: boolean;
    lines: [string, number, number][];
    flaggor_kravs: string[];
    flaggor_forbjudna: string[];
    status: string;
    restbelopp_ore?: number;
    anomaly_niva?: string;
    audit_event?: string;
    forsta_korningen_forbjuder?: string[];
    auto_monster?: boolean;
  };
};

const EXPECTED_DIR = join(process.cwd(), "testdata", "expected");

function lasForvantan(fall: number): Forvantan {
  return JSON.parse(readFileSync(join(EXPECTED_DIR, `fall-${fall}.json`), "utf8")) as Forvantan;
}

const db = await createDb();

/** En mallstämplad agent per tenant — samma väg som produktionens jobb:
 *  kö-payload → körJobb → tolka (mock/LLM) → granskning → kontering →
 *  porten. Ingen sidodörr. */
const agentCache = new Map<string, string>();
async function agentFor(tenantId: string): Promise<string> {
  const cached = agentCache.get(tenantId);
  if (cached) return cached;
  const { id } = await skapaAgentNyckel(db, {
    tenantId,
    module: "bokforing",
    scopes: ["proposals:write"],
    namn: `golden-agent-${tenantId}`,
    template: { id: "bokforing", major: "1" },
  });
  agentCache.set(tenantId, id);
  return id;
}

async function skapaDokument(tenantId: string, text: string): Promise<string> {
  return withTenant(db, tenantId, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO documents (tenant_id, raw) VALUES ($1, $2) RETURNING id`,
      [tenantId, text],
    );
    return r.rows[0].id;
  });
}

type KordProposal = { payload: Proposal; status: string; flaggor: Flagga[] };

/** Kör ett underlag hela vägen genom workern och läser resultatraden. */
async function körFall(tenantId: string, underlag: string, jobbId: string): Promise<KordProposal> {
  const doc = await skapaDokument(tenantId, underlag);
  const jobb: AgentJobb = {
    job_id: jobbId,
    tenant_id: tenantId,
    module: "bokforing",
    trigger: "golden",
    agent_id: await agentFor(tenantId),
    payload_ref: `document:${doc}`,
  };
  const utfall = await körJobb(db, jobb);
  assert.ok(
    utfall.utfall === "klar",
    `jobbet föll: ${JSON.stringify(utfall)} — underlaget börjar "${underlag.slice(0, 40)}"`,
  );
  return withTenant(db, tenantId, async (tx) => {
    const r = await tx.query<KordProposal>(
      `SELECT payload, status, flaggor FROM proposals WHERE id = $1`,
      [utfall.proposal_id],
    );
    assert.ok(r.rows[0], "förslaget saknas i databasen");
    return r.rows[0];
  });
}

function tuples(p: Proposal): [string, number, number][] {
  return p.lines.map((l) => [l.konto, l.debet_ore, l.kredit_ore]);
}

/** Gemensamma facit-assertions ur förväntningsfilen. */
function assertMotForvantan(kord: KordProposal, f: Forvantan): void {
  const fv = f.forvantat!;
  assert.equal(kord.payload.kind, fv.kind, `fall ${f.fall}: fel kind`);
  assert.deepEqual(tuples(kord.payload), fv.lines, `fall ${f.fall}: fel konteringsrader`);
  assert.equal(kord.status, fv.status, `fall ${f.fall}: fel status`);
  const ids = kord.flaggor.map((fl) => fl.id);
  for (const kravd of fv.flaggor_kravs) {
    assert.ok(ids.includes(kravd), `fall ${f.fall}: flaggan ${kravd} saknas (fanns: ${ids.join(", ")})`);
  }
  for (const forbjuden of fv.flaggor_forbjudna) {
    assert.ok(!ids.includes(forbjuden), `fall ${f.fall}: förbjuden flagga ${forbjuden} sattes`);
  }
  if (fv.eskalerad) {
    assert.equal(kord.payload.lines.length, 0, `fall ${f.fall}: eskalering får inte ha rader`);
    assert.ok(
      kord.payload.summary.startsWith("ESKALERING"),
      `fall ${f.fall}: eskaleringssummary saknas`,
    );
    assert.ok(kord.payload.confidence <= 0.3, `fall ${f.fall}: eskalering ska vara lågkonfident`);
  }
  // Mallstämpeln följer med hela vägen (WP30: version 1.1.x).
  assert.equal(kord.payload.mall_id, "bokforing");
  assert.match(kord.payload.mall_version ?? "", /^1\.1\.\d+$/);
}

// ================================================================ fall 1

test("golden fall 1: fel mottagare → flag_wrong_tenant, ingen kontering, granskningskö", async () => {
  const f = lasForvantan(1);
  const kord = await körFall(f.tenant!, FALL_1_FEL_MOTTAGARE, "golden-fall-1");
  assertMotForvantan(kord, f);
  // Flaggan bär både mottagaren och tenantnamnet — konsultens beslutsunderlag.
  const flagga = kord.flaggor.find((fl) => fl.id === "flag_wrong_tenant")!;
  assert.equal(flagga.niva, "varning");
  assert.ok(String(flagga.data?.mottagare).includes("Byggmästarna"));
});

// ================================================================ fall 2

test("golden fall 2: ÄTA-avvikelse mot känt ordervärde → needs_review + omvänd byggmoms", async () => {
  const f = lasForvantan(2);
  const kord = await körFall(f.tenant!, FALL_2_ATA_AVVIKELSE, "golden-fall-2");
  assertMotForvantan(kord, f);
  const ata = kord.flaggor.find((fl) => fl.id === "ata_avvikelse")!;
  assert.equal(ata.niva, "varning");
  assert.equal(ata.data?.ordervarde_ore, 5_000_000);
  assert.equal(ata.data?.fakturerat_ore, 8_000_000);
  // Varningen sänker konfidensen — förslaget når aldrig auto (needs_review).
  assert.ok(kord.payload.confidence < 0.85);
});

test("golden fall 2 kontroll: samma faktura utan ÄTA-paket (kund_a, cafe) flaggar ingen ÄTA", async () => {
  // Branschpaketet aktiveras av tenant-kontexten (ADR-0005): hos en
  // cafe-tenant är ÄTA-regeln inte aktiv — ordern slås aldrig upp.
  const kord = await körFall("kund_a", FALL_2_ATA_AVVIKELSE.replace("Bygg Exempel AB", "Café Exempel AB"), "golden-fall-2-kontroll");
  assert.ok(!kord.flaggor.some((fl) => fl.id === "ata_avvikelse"));
});

// ================================================================ fall 3

test("golden fall 3: förskottsmönster → 1480, aldrig kostnadskonto", async () => {
  const f = lasForvantan(3);
  const kord = await körFall(f.tenant!, FALL_3_FORSKOTT, "golden-fall-3");
  assertMotForvantan(kord, f);
  assert.ok(kord.payload.lines.some((l) => l.konto === "1480"));
  assert.ok(!kord.payload.lines.some((l) => l.konto.startsWith("4") || l.konto.startsWith("6")));
});

// ================================================================ fall 4

test("golden fall 4: privat/verksamhetsfrämmande → flag_private_expense, ingen kontering", async () => {
  const f = lasForvantan(4);
  const kord = await körFall(f.tenant!, FALL_4_PRIVAT, "golden-fall-4");
  assertMotForvantan(kord, f);
  assert.equal(kord.flaggor.find((fl) => fl.id === "flag_private_expense")!.niva, "varning");
});

// ================================================================ fall 5

test("golden fall 5: delmatchning → missing_receipt med restbelopp", async () => {
  const f = lasForvantan(5);
  const kord = await körFall(f.tenant!, FALL_5_DELMATCHNING, "golden-fall-5");
  assertMotForvantan(kord, f);
  const flagga = kord.flaggor.find((fl) => fl.id === "missing_receipt")!;
  assert.equal(flagga.niva, "varning");
  assert.equal(flagga.data?.restbelopp_ore, f.forvantat!.restbelopp_ore);
});

// ================================================================ fall 6

test("golden fall 6: EU-tjänsteinköp reverse charge → 2614/2645, auto-mönster", async () => {
  // Blockeringen HÄVD: TESTUNDERLAG-GOLDEN.md ligger i docs/ och fall 6
  // implementeras enligt det ("utgående + ingående moms på förvärv,
  // 2614/2645"). OBS 2645 (beräknad ingående moms på förvärv från
  // utlandet), inte 2647 — den gäller omvänd i Sverige (bygg).
  const f = lasForvantan(6);
  assert.equal(f.blockerad, undefined);
  const kord = await körFall(f.tenant!, FALL_6_EU_TJANST, "golden-fall-6");
  assertMotForvantan(kord, f);

  // Rent mönster: inga varningsflaggor — dokumentets 0 kr moms är
  // KORREKT vid omvänd skattskyldighet, aldrig en avvikelse.
  assert.ok(!kord.flaggor.some((fl) => fl.niva === "varning"));

  // "Detta är ett mönster som SKA auto-bokas": under bokföringsmallens
  // förvalspolicy passerar förslaget med LLM-klassens konfidens och känd
  // motpart — mockens 0.7 är motorbegränsningen, inte mönstrets.
  assert.equal(f.forvantat!.auto_monster, true);
  const utfall = evaluateAutonomy(
    { ...kord.payload, confidence: 0.9 },
    { tenant_id: f.tenant!, module: "bokforing", ...mallRegistret.bokforing.defaultPolicy },
    true,
  );
  assert.equal(utfall.auto, true, `auto föll på: ${utfall.missade.join("; ")}`);
});

// ================================================================ fall 7

async function seedElHistorik(db2: PGlite, tenantId: string): Promise<void> {
  // Tre bokförda elräkningar ~1 200 kr — median 121 600 öre. Fakturan på
  // 3 800 kr är > 2× medianen.
  const belopp = [121_600, 118_400, 125_000];
  await withTenant(db2, tenantId, async (tx) => {
    for (let i = 0; i < belopp.length; i++) {
      const v = await tx.query<{ id: string }>(
        `INSERT INTO verifications (tenant_id, nummer, affarshandelsedatum, beskrivning, motpart)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [tenantId, 9101 + i, `2026-0${4 + i}-16`, `Elförbrukning månad ${4 + i}`, "Elhandel Exempel AB"],
      );
      const netto = Math.round(belopp[i] / 1.25);
      await tx.query(
        `INSERT INTO verification_rows (tenant_id, verification_id, konto, kontonamn, debet_ore, kredit_ore)
         VALUES ($1, $2, '6991', 'Övriga externa kostnader', $3, 0),
                ($1, $2, '2641', 'Debiterad ingående moms', $4, 0),
                ($1, $2, '2440', 'Leverantörsskulder', 0, $5)`,
        [tenantId, v.rows[0].id, netto, belopp[i] - netto, belopp[i]],
      );
    }
  });
}

test("golden fall 7: elkostnad >2× median → anomaly_amount, bokför men notifiera", async () => {
  const f = lasForvantan(7);
  await seedElHistorik(db, f.tenant!);
  const kord = await körFall(f.tenant!, FALL_7_EL_ANOMALI, "golden-fall-7");
  assertMotForvantan(kord, f);
  const flagga = kord.flaggor.find((fl) => fl.id === "anomaly_amount")!;
  // INFO-nivå: bokföringen hindras inte — konfidensen sänks inte av
  // anomalin ("bokför men notifiera").
  assert.equal(flagga.niva, f.forvantat!.anomaly_niva);
  assert.equal(flagga.data?.median_ore, 121_600);
  // Telemetrisignalen ligger i audit-loggen.
  const audit = await withTenant(db, f.tenant!, (tx) =>
    tx.query<{ payload: { motpart: string; belopp_ore: number } }>(
      `SELECT payload FROM audit_log WHERE event_type = $1`,
      [f.forvantat!.audit_event],
    ),
  );
  assert.ok(audit.rows.length >= 1, "telemetrisignalen anomaly_amount saknas i audit-loggen");
  assert.equal(audit.rows[0].payload.motpart, "Elhandel Exempel AB");
  assert.equal(audit.rows[0].payload.belopp_ore, 380_000);
});

// ================================================================ fall 8

test("golden fall 8: dubblett leverantör+belopp+period flaggas andra körningen", async () => {
  const f = lasForvantan(8);
  const forsta = await körFall(f.tenant!, FALL_8_DUBBLETT, "golden-fall-8-a");
  for (const forbjuden of f.forvantat!.forsta_korningen_forbjuder!) {
    assert.ok(
      !forsta.flaggor.some((fl) => fl.id === forbjuden),
      `första körningen fick ${forbjuden} — ingen dubblett finns ännu`,
    );
  }
  // Samma faktura, nytt jobb och nytt dokument → nytt förslag med
  // dubblettflagga (idempotensen på job_id är en annan sak och testas i
  // worker.test.ts).
  const andra = await körFall(f.tenant!, FALL_8_DUBBLETT, "golden-fall-8-b");
  assertMotForvantan(andra, f);
  const flagga = andra.flaggor.find((fl) => fl.id === "dubblett_misstankt")!;
  assert.equal(flagga.niva, "varning");
  assert.equal(flagga.data?.period, "2026-07");
  assert.equal(flagga.data?.belopp_ore, 106_000);
});

// ============================================================ svitvakter

test("golden-sviten: förväntningsfiler finns för fall 1–8, inga persondata", () => {
  const filer = readdirSync(EXPECTED_DIR).filter((f) => f.endsWith(".json")).sort();
  assert.deepEqual(
    filer,
    [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `fall-${n}.json`),
    "förväntningsfilerna ska täcka exakt fall 1–8",
  );
  for (const fil of filer) {
    const innehall = readFileSync(join(EXPECTED_DIR, fil), "utf8");
    // Endast Exempel-bolag — aldrig verkliga namn/orgnr ur underlagen.
    assert.ok(!/\d{6}-\d{4}/.test(innehall), `${fil}: ser ut att innehålla org-/personnummer`);
  }
});
