import { test } from "node:test";
import assert from "node:assert/strict";
import { bestamMoms } from "../src/lib/moms";

// Momsdemots kärna: samma kategori, olika affärshändelsedatum → olika sats.
// Livsmedel: 12 % t.o.m. 2026-03-31, tillfälligt 6 % 2026-04-01–2027-12-31
// (prop. 2025/26:55), åter 12 % fr.o.m. 2028-01-01.

test("livsmedel 2026-03-15 → 12 %", () => {
  const m = bestamMoms("livsmedel", "2026-03-15", "kund_a");
  assert.equal(m.sats, 12);
  assert.equal(m.typ, "ingaende");
});

test("livsmedel 2026-07-08 → 6 % (tillfällig sänkning)", () => {
  const m = bestamMoms("livsmedel", "2026-07-08", "kund_a");
  assert.equal(m.sats, 6);
  assert.match(m.lagrum, /2025\/26:55/);
});

test("livsmedel exakt på brytdatumen", () => {
  assert.equal(bestamMoms("livsmedel", "2026-03-31", "kund_a").sats, 12);
  assert.equal(bestamMoms("livsmedel", "2026-04-01", "kund_a").sats, 6);
  assert.equal(bestamMoms("livsmedel", "2027-12-31", "kund_a").sats, 6);
  assert.equal(bestamMoms("livsmedel", "2028-01-01", "kund_a").sats, 12);
});

test("restaurang/catering är kvar på 12 %", () => {
  assert.equal(bestamMoms("restaurang_catering", "2026-07-08", "kund_a").sats, 12);
});

test("persontransport → 6 %, standard/okänd kategori → 25 %", () => {
  assert.equal(bestamMoms("persontransport", "2026-07-08", "kund_a").sats, 6);
  assert.equal(bestamMoms("ovrigt", "2026-07-08", "kund_a").sats, 25);
  assert.equal(bestamMoms("it_tjanster", "2026-07-08", "kund_a").sats, 25);
});

test("byggtjänst hos byggkund (kund_b) → omvänd betalningsskyldighet ML 16:13", () => {
  const m = bestamMoms("byggtjanst", "2026-07-01", "kund_b");
  assert.equal(m.typ, "omvand");
  assert.equal(m.sats, 25);
  assert.match(m.lagrum, /16 kap\. 13 §/);
  assert.equal(m.konton.omvand_utgaende, "2614");
  assert.equal(m.konton.omvand_ingaende, "2647");
  assert.deepEqual(m.deklarationsrutor, { underlag: "24", utgaende: "30", ingaende: "48" });
});

test("byggtjänst hos café-kund (kund_a, omvand_bygg=false) → vanlig 25 %", () => {
  const m = bestamMoms("byggtjanst", "2026-07-01", "kund_a");
  assert.equal(m.typ, "ingaende");
  assert.equal(m.sats, 25);
});
