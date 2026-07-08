import { PGlite } from "@electric-sql/pglite";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// PGlite = riktig Postgres in-process (WASM). Demon kör den mot .data/
// (gitignorerad); testerna skapar in-memory-instanser via createDb().
// Produktionsvägen är vanlig Postgres — samma SQL, samma policyer.

const REPO_ROOT = process.cwd();
const DATA_DIR = join(REPO_ROOT, ".data", "grundbok");

function sqlFile(name: string): string {
  return readFileSync(join(REPO_ROOT, "src", "lib", "db", name), "utf8");
}

export async function migrate(db: PGlite): Promise<void> {
  // Alla tre filerna är idempotenta (IF NOT EXISTS / exception-guards /
  // DROP TRIGGER IF EXISTS) — de körs vid varje uppstart så att nya
  // tabeller och policyer landar utan att befintlig data nollställs.
  await db.exec(sqlFile("schema.sql"));
  await db.exec(sqlFile("rls.sql"));
  await db.exec(sqlFile("triggers.sql"));
  await seed(db);
}

async function seed(db: PGlite): Promise<void> {
  const customersDir = join(REPO_ROOT, "customers");
  for (const file of readdirSync(customersDir)) {
    if (!file.endsWith(".config.json")) continue;
    const config = JSON.parse(readFileSync(join(customersDir, file), "utf8"));
    await db.query(
      `INSERT INTO tenants (id, namn, mall) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [config.tenant_id, config.namn, config.mall.id],
    );

    // Default-autonomipolicyer (ändras i adminkonsolens policy-editor):
    // bokforing börjar helt manuell — dagens beteende bevaras tills
    // konsulten aktivt lättar policyn. radgivning är läsande
    // (advisory_answer, ingen ledger-effekt) och får auto-godkännas.
    await db.query(
      `INSERT INTO autonomy_policies
         (tenant_id, module, max_belopp_ore, min_confidence, kanda_motparter_endast, tillatna_kinds)
       VALUES
         ($1, 'bokforing', 0, 1, true, '[]'),
         ($1, 'radgivning', 0, 0.5, false, '["advisory_answer"]')
       ON CONFLICT (tenant_id, module) DO NOTHING`,
      [config.tenant_id],
    );
  }
}

/** Ny, isolerad in-memory-databas — används av testsviten. */
export async function createDb(): Promise<PGlite> {
  const db = new PGlite();
  await migrate(db);
  return db;
}

// Singleton för appen — överlever Next.js HMR via globalThis.
const globalForDb = globalThis as unknown as { __grundbokDb?: Promise<PGlite> };

export function getDb(): Promise<PGlite> {
  if (!globalForDb.__grundbokDb) {
    globalForDb.__grundbokDb = (async () => {
      mkdirSync(DATA_DIR, { recursive: true });
      const db = new PGlite(DATA_DIR);
      await migrate(db);
      return db;
    })().catch((err) => {
      // Cacha aldrig en misslyckad init — nästa anrop får försöka igen.
      globalForDb.__grundbokDb = undefined;
      throw err;
    });
  }
  return globalForDb.__grundbokDb;
}
