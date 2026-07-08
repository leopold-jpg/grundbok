import { test } from "node:test";
import assert from "node:assert/strict";
import { tolka } from "../src/lib/extract";
import { tolkaMedFallback } from "../src/lib/extract/fallback";
import { ExtraktionSchema } from "../src/lib/extract/schema";
import { kaffefaktura, BYGGFAKTURA } from "../src/lib/exempel";

// Verifierar den deterministiska fallbacken UTAN nät (punkt 3 i bygget):
//   npm run test:fallback
// kör med GRUNDBOK_FORCE_FALLBACK=1 så att inga API-anrop ens försöks.
// Testerna här sätter dessutom flaggan själva, så de är nätoberoende
// även under vanliga `npm test`.

process.env.GRUNDBOK_FORCE_FALLBACK = "1";

test("fallbacken tolkar kaffefakturan (juli) schema-giltigt och korrekt", () => {
  const e = ExtraktionSchema.parse(tolkaMedFallback(kaffefaktura("2026-07-08", 6)));
  assert.equal(e.datum, "2026-07-08");
  assert.equal(e.netto_ore, 100_000);
  assert.equal(e.moms_ore, 6_000);
  assert.equal(e.brutto_ore, 106_000);
  assert.equal(e.kategori, "livsmedel");
  assert.equal(e.betalsatt, "faktura");
  assert.match(e.motpart, /Kafferosteriet/);
});

test("fallbacken tolkar kaffefakturan (mars) med 12 % moms", () => {
  const e = ExtraktionSchema.parse(tolkaMedFallback(kaffefaktura("2026-03-15", 12)));
  assert.equal(e.datum, "2026-03-15");
  assert.equal(e.moms_ore, 12_000);
  assert.equal(e.momssats_angiven, 12);
});

test("fallbacken tolkar byggfakturan som byggtjänst", () => {
  const e = ExtraktionSchema.parse(tolkaMedFallback(BYGGFAKTURA));
  assert.equal(e.kategori, "byggtjanst");
  assert.equal(e.netto_ore, 1_000_000);
  assert.equal(e.betalsatt, "faktura");
});

test("tolka() rapporterar motor=fallback med skäl när fallbacken tvingas", async () => {
  const r = await tolka(kaffefaktura("2026-07-08", 6));
  assert.equal(r.motor, "fallback");
  assert.ok(r.motor_detalj.length > 0);
  assert.equal(r.extraktion.netto_ore, 100_000);
});

test("svensk decimal- och tusentalshantering: '1 234,56 kr' → 123456 ören", () => {
  const e = tolkaMedFallback(`Testleverantör AB\n2026-05-01\nNettobelopp: 1 234,56 kr\nAtt betala: 1 234,56 kr`);
  assert.equal(e.netto_ore, 123_456);
});
