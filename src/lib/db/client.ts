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
  const done = await db
    .query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables WHERE table_name = 'tenants'
       ) AS exists`,
    )
    .then((r) => r.rows[0]?.exists);
  if (done) return;
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
