import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { withTenant } from "../src/lib/db/tenant";

// De 5 RLS-/append-only-smoke-testerna (ULTRAPLAN §2, §7) — körbara live:
//   npm test
// Testerna kör mot samma schema.sql/rls.sql/triggers.sql som appen,
// i en isolerad in-memory-Postgres (PGlite).

const db = await createDb();

// Testdata skrivs som respektive tenant — precis som appen gör.
await withTenant(db, "kund_a", async (tx) => {
  await tx.query(
    `INSERT INTO documents (tenant_id, raw) VALUES ('kund_a', 'kvitto A')`,
  );
  await tx.query(
    `INSERT INTO verifications (tenant_id, nummer, affarshandelsedatum, beskrivning, motpart)
     VALUES ('kund_a', 1, '2026-07-08', 'Kaffebönor', 'Kafferosteriet Exempel AB')`,
  );
});
await withTenant(db, "kund_b", async (tx) => {
  await tx.query(
    `INSERT INTO documents (tenant_id, raw) VALUES ('kund_b', 'faktura B')`,
  );
});

test("1. RLS select: tenanten ser bara sina egna rader", async () => {
  const somA = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ raw: string }>(`SELECT raw FROM documents`),
  );
  assert.equal(somA.rows.length, 1);
  assert.equal(somA.rows[0].raw, "kvitto A");

  const somB = await withTenant(db, "kund_b", (tx) =>
    tx.query<{ raw: string }>(`SELECT raw FROM documents`),
  );
  assert.equal(somB.rows.length, 1);
  assert.equal(somB.rows[0].raw, "faktura B");
});

test("2. RLS with check: skrivning till annan tenant blockeras av databasen", async () => {
  await assert.rejects(
    withTenant(db, "kund_a", (tx) =>
      tx.query(`INSERT INTO documents (tenant_id, raw) VALUES ('kund_b', 'smuggling')`),
    ),
    /row-level security|policy/i,
  );
});

test("3. Append-only: UPDATE på bokförd verifikation nekas", async () => {
  await assert.rejects(
    withTenant(db, "kund_a", (tx) =>
      tx.query(`UPDATE verifications SET beskrivning = 'manipulerad' WHERE nummer = 1`),
    ),
    /permission denied|får inte ändras/i,
  );
});

test("4. Append-only: DELETE på bokförd verifikation nekas", async () => {
  await assert.rejects(
    withTenant(db, "kund_a", (tx) =>
      tx.query(`DELETE FROM verifications WHERE nummer = 1`),
    ),
    /permission denied|får inte ändras/i,
  );
});

test("5. Insert till egen tenant fungerar (rättelseposter kräver det)", async () => {
  const fore = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM verifications`),
  );
  await withTenant(db, "kund_a", (tx) =>
    tx.query(
      `INSERT INTO verifications (tenant_id, nummer, affarshandelsedatum, beskrivning, motpart, rattar_verifikation)
       SELECT 'kund_a', 2, '2026-07-08', 'Rättelse av verifikation 1', 'Kafferosteriet Exempel AB', id
       FROM verifications WHERE nummer = 1`,
    ),
  );
  const efter = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM verifications`),
  );
  assert.equal(Number(efter.rows[0].n), Number(fore.rows[0].n) + 1);
});
