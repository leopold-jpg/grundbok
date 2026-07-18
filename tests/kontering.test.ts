import { test } from "node:test";
import assert from "node:assert/strict";
import { kontera } from "../src/lib/kontering";
import { OBSERVATIONS_DEFAULTS, type Extraktion } from "../src/lib/extract/schema";

// Demofallens facit — verifierade mot officiella BAS 2025-tabellen och
// Skatteverket (se skills/se/*/SKILL.md, worked examples). Exemplen i
// SKILL.md och testerna här ska aldrig kunna glida isär.

const kaffe = (datum: string, moms_ore: number | null): Extraktion => ({
  ...OBSERVATIONS_DEFAULTS,
  motpart: "Kafferosteriet Exempel AB",
  beskrivning: "Kaffebönor, mörkrost 20 kg",
  datum,
  netto_ore: 100_000,
  moms_ore,
  brutto_ore: moms_ore === null ? null : 100_000 + moms_ore,
  momssats_angiven: null,
  kategori: "livsmedel",
  betalsatt: "faktura",
});

test("facit (a) juli 2026: 4010 D 1000 / 2641 D 60 / 2440 K 1060", () => {
  const f = kontera(kaffe("2026-07-08", 6_000), "kund_a");
  assert.equal(f.moms.sats, 6);
  assert.deepEqual(
    f.rader.map((r) => [r.konto, r.debet_ore, r.kredit_ore]),
    [
      ["4010", 100_000, 0],
      ["2641", 6_000, 0],
      ["2440", 0, 106_000],
    ],
  );
  assert.equal(f.brutto_ore, 106_000);
  assert.equal(f.flaggor.length, 0);
});

test("facit (a) mars 2026: samma kvitto, 12 % → 2641 D 120 / 2440 K 1120", () => {
  const f = kontera(kaffe("2026-03-15", 12_000), "kund_a");
  assert.equal(f.moms.sats, 12);
  assert.deepEqual(
    f.rader.map((r) => [r.konto, r.debet_ore, r.kredit_ore]),
    [
      ["4010", 100_000, 0],
      ["2641", 12_000, 0],
      ["2440", 0, 112_000],
    ],
  );
});

test("facit (b) bygg: 4425 D 10000 / 2440 K 10000 / 2614 K 2500 / 2647 D 2500", () => {
  const f = kontera(
    {
      ...OBSERVATIONS_DEFAULTS,
      motpart: "Underentreprenad Exempel AB",
      beskrivning: "Markarbeten etapp 2",
      datum: "2026-07-01",
      netto_ore: 1_000_000,
      moms_ore: 0,
      brutto_ore: 1_000_000,
      momssats_angiven: null,
      kategori: "byggtjanst",
      betalsatt: "faktura",
    },
    "kund_b",
  );
  assert.equal(f.moms.typ, "omvand");
  assert.deepEqual(
    f.rader.map((r) => [r.konto, r.debet_ore, r.kredit_ore]),
    [
      ["4425", 1_000_000, 0],
      ["2440", 0, 1_000_000],
      ["2614", 0, 250_000],
      ["2647", 250_000, 0],
    ],
  );
  // Nettoeffekt noll vid full avdragsrätt; deklarationsrutor 24/30/48.
  const debet = f.rader.reduce((s, r) => s + r.debet_ore, 0);
  const kredit = f.rader.reduce((s, r) => s + r.kredit_ore, 0);
  assert.equal(debet, kredit);
});

test("momsdemot: kvitto daterat mars med 12 % moms, växlat till juli → flagga + regelverkets 6 %", () => {
  // Konsulten ändrar affärshändelsedatum i UI:t — regelmotorn räknar om
  // med datumets sats och flaggar avvikelsen mot dokumentets angivna moms.
  const f = kontera(kaffe("2026-03-15", 12_000), "kund_a", "2026-07-08");
  assert.equal(f.moms.sats, 6);
  assert.equal(f.affarshandelsedatum, "2026-07-08");
  const flagga = f.flaggor.find((fl) => fl.id === "momssats_avviker");
  assert.ok(flagga, "avvikelsen ska flaggas för konsulten, aldrig ersättas tyst");
});

test("invarianter: debet = kredit och skill-versioner stämplas på förslaget", () => {
  const f = kontera(kaffe("2026-07-08", 6_000), "kund_a");
  const debet = f.rader.reduce((s, r) => s + r.debet_ore, 0);
  const kredit = f.rader.reduce((s, r) => s + r.kredit_ore, 0);
  assert.equal(debet, kredit);
  assert.equal(f.skill_versions["se/moms"], "1.1.0");
  assert.equal(f.skill_versions["se/bas-kontering"], "1.0.0");
});

test("BFL 5:7: förslag utan motpart avvisas av motorn", () => {
  assert.throws(
    () => kontera({ ...kaffe("2026-07-08", 6_000), motpart: "" }, "kund_a"),
    /BFL 5 kap\. 7 §/,
  );
});

test("beloppsgräns: brutto över kundens gräns flaggas för granskning", () => {
  const stor = { ...kaffe("2026-07-08", null), netto_ore: 2_000_000, moms_ore: null };
  const f = kontera(stor, "kund_a");
  assert.ok(f.flaggor.some((fl) => fl.id === "belopp_over_grans"));
});
