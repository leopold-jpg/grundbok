import type { PGlite, Transaction } from "@electric-sql/pglite";

// All åtkomst till kunddata går genom withTenant: en transaktion där
// tenant-kontexten sätts parametriserat och transaktionsscopat
// (set_config(..., true)) och appen byter till den icke-ägande rollen
// grundbok_app. Detta är den medvetna korrigeringen av ClawKeepers
// session-SET-på-delad-pool-bugg (se ATTRIBUTION.md): kontexten kan
// aldrig läcka mellan requests, och rollen kan inte förbi RLS.
export async function withTenant<T>(
  db: PGlite,
  tenantId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await tx.exec(`SET LOCAL ROLE grundbok_app`);
    return fn(tx);
  });
}
