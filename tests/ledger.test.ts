import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { withTenant } from "../src/lib/db/tenant";
import { kontera } from "../src/lib/kontering";
import { hashForslag } from "../src/lib/policy";
import { fattaBeslut, skapaRattelse } from "../src/lib/ledger";
import type { Extraktion } from "../src/lib/extract/schema";

// Hela beslutskedjan ände till ände: förslag → godkännande (hash-bundet)
// → append-only-verifikation med löpnummer → rättelsepost.

const db = await createDb();

const extraktion: Extraktion = {
  motpart: "Kafferosteriet Exempel AB",
  beskrivning: "Kaffebönor, mörkrost 20 kg",
  datum: "2026-07-08",
  netto_ore: 100_000,
  moms_ore: 6_000,
  brutto_ore: 106_000,
  momssats_angiven: 6,
  kategori: "livsmedel",
  betalsatt: "faktura",
};

async function skapaForslag(tenantId: string) {
  const forslag = kontera(extraktion, tenantId);
  return withTenant(db, tenantId, async (tx) => {
    const doc = await tx.query<{ id: string }>(
      `INSERT INTO documents (tenant_id, raw) VALUES ($1, 'test') RETURNING id`,
      [tenantId],
    );
    const sug = await tx.query<{ id: string }>(
      `INSERT INTO suggestions (tenant_id, document_id, payload, hash, engine, skill_versions, flaggor)
       VALUES ($1, $2, $3, $4, 'fallback', $5, $6) RETURNING id`,
      [
        tenantId,
        doc.rows[0].id,
        JSON.stringify(forslag),
        hashForslag(forslag),
        JSON.stringify(forslag.skill_versions),
        JSON.stringify(forslag.flaggor),
      ],
    );
    return sug.rows[0].id;
  });
}

test("godkännande bokför: verifikation med löpnummer 1, balanserade rader, extern ref", async () => {
  const suggestionId = await skapaForslag("kund_a");
  const resultat = await fattaBeslut(db, "kund_a", suggestionId, "godkand", "konsult@byran.se");
  assert.equal(resultat.status, "bokford");
  if (resultat.status !== "bokford") return;
  assert.equal(resultat.verifikation.nummer, 1);
  assert.match(resultat.verifikation.extern_ref, /^FTX-MOCK-2026-0001$/);

  const rader = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ debet_ore: number; kredit_ore: number }>(
      `SELECT debet_ore, kredit_ore FROM verification_rows WHERE verification_id = $1`,
      [resultat.verifikation.id],
    ),
  );
  const debet = rader.rows.reduce((s, r) => s + Number(r.debet_ore), 0);
  const kredit = rader.rows.reduce((s, r) => s + Number(r.kredit_ore), 0);
  assert.equal(debet, kredit);
  assert.equal(debet, 106_000);
});

test("löpnummer är tenant-scopat: kund_b börjar på 1 oavsett kund_a", async () => {
  const suggestionId = await skapaForslag("kund_b");
  const resultat = await fattaBeslut(db, "kund_b", suggestionId, "godkand", "konsult@byran.se");
  assert.equal(resultat.status, "bokford");
  if (resultat.status === "bokford") assert.equal(resultat.verifikation.nummer, 1);
});

test("avvisat förslag bokförs inte", async () => {
  const suggestionId = await skapaForslag("kund_a");
  const resultat = await fattaBeslut(db, "kund_a", suggestionId, "avvisad", "konsult@byran.se");
  assert.equal(resultat.status, "avvisad");
  const status = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ status: string }>(`SELECT status FROM suggestions WHERE id = $1`, [suggestionId]),
  );
  assert.equal(status.rows[0].status, "avvisad");
});

test("samma förslag kan inte beslutas två gånger", async () => {
  const suggestionId = await skapaForslag("kund_a");
  await fattaBeslut(db, "kund_a", suggestionId, "godkand", "konsult@byran.se");
  await assert.rejects(
    fattaBeslut(db, "kund_a", suggestionId, "godkand", "konsult@byran.se"),
    /redan bokford/,
  );
});

test("konsult i fel tenant-kontext når inte förslaget alls (RLS)", async () => {
  const suggestionId = await skapaForslag("kund_a");
  await assert.rejects(
    fattaBeslut(db, "kund_b", suggestionId, "godkand", "konsult@byran.se"),
    /finns inte/,
  );
});

test("rättelsepost: nya omvända rader med referens — originalet orört", async () => {
  const suggestionId = await skapaForslag("kund_a");
  const bokfort = await fattaBeslut(db, "kund_a", suggestionId, "godkand", "konsult@byran.se");
  if (bokfort.status !== "bokford") throw new Error("förväntade bokförd");

  const rattelse = await skapaRattelse(db, "kund_a", bokfort.verifikation.id, "konsult@byran.se");
  assert.ok(rattelse.nummer > bokfort.verifikation.nummer);

  const rader = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ konto: string; debet_ore: number; kredit_ore: number }>(
      `SELECT konto, debet_ore, kredit_ore FROM verification_rows WHERE verification_id = $1 ORDER BY konto`,
      [rattelse.id],
    ),
  );
  // Omvända rader: 2440 nu debet, 4010 nu kredit.
  const r2440 = rader.rows.find((r) => r.konto === "2440");
  const r4010 = rader.rows.find((r) => r.konto === "4010");
  assert.equal(Number(r2440?.debet_ore), 106_000);
  assert.equal(Number(r4010?.kredit_ore), 100_000);

  const ref = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ rattar_verifikation: string }>(
      `SELECT rattar_verifikation FROM verifications WHERE id = $1`,
      [rattelse.id],
    ),
  );
  assert.equal(ref.rows[0].rattar_verifikation, bokfort.verifikation.id);
});
