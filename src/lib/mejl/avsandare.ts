import type { PGlite } from "@electric-sql/pglite";
import { withTenant } from "@/lib/db/tenant";
import { auditera } from "@/lib/ledger";

// Registrerade avsändaradresser (WP23): endast mejl från dessa släpps
// in i intake-flödet — övriga hamnar i karantän. Klienten anger sina
// adresser i appen; byrån ser listan i klientvyn. Tenant-scopat via
// withTenant/RLS som all annan kunddata.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type Avsandare = { id: string; email: string; created_at: string };

export async function listaAvsandare(db: PGlite, tenantId: string): Promise<Avsandare[]> {
  return withTenant(db, tenantId, async (tx) => {
    const r = await tx.query<{ id: string; email: string; created_at: Date | string }>(
      `SELECT id, email, created_at FROM klient_avsandare ORDER BY created_at`,
    );
    return r.rows.map((rad) => ({
      id: rad.id,
      email: rad.email,
      created_at: (rad.created_at instanceof Date
        ? rad.created_at
        : new Date(rad.created_at)
      ).toISOString(),
    }));
  });
}

export async function laggTillAvsandare(
  db: PGlite,
  input: { tenantId: string; email: string; registreradAv: string },
): Promise<Avsandare> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error("Ogiltig e-postadress");
  return withTenant(db, input.tenantId, async (tx) => {
    // DO NOTHING + omläsning i stället för DO UPDATE: app-rollen har
    // medvetet ingen UPDATE-rättighet på tabellen — en dubbelregistrering
    // är en no-op, inte en ändring.
    await tx.query(
      `INSERT INTO klient_avsandare (tenant_id, email, registrerad_av)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, email) DO NOTHING`,
      [input.tenantId, email, input.registreradAv],
    );
    const r = await tx.query<{ id: string; created_at: Date | string }>(
      `SELECT id, created_at FROM klient_avsandare WHERE email = $1`,
      [email],
    );
    await auditera(tx, input.tenantId, "avsandare_registrerad", {
      email,
      registreradAv: input.registreradAv,
    });
    return {
      id: r.rows[0].id,
      email,
      created_at: (r.rows[0].created_at instanceof Date
        ? r.rows[0].created_at
        : new Date(r.rows[0].created_at)
      ).toISOString(),
    };
  });
}

export async function taBortAvsandare(
  db: PGlite,
  input: { tenantId: string; avsandareId: string; borttagenAv: string },
): Promise<void> {
  await withTenant(db, input.tenantId, async (tx) => {
    const r = await tx.query<{ email: string }>(
      `DELETE FROM klient_avsandare WHERE id = $1 RETURNING email`,
      [input.avsandareId],
    );
    if (!r.rows[0]) throw new Error("Avsändaren finns inte");
    await auditera(tx, input.tenantId, "avsandare_borttagen", {
      email: r.rows[0].email,
      borttagenAv: input.borttagenAv,
    });
  });
}

/** Är adressen registrerad för tenanten? (Inbound-flödets vakt.) */
export async function arRegistreradAvsandare(
  db: PGlite,
  tenantId: string,
  email: string,
): Promise<boolean> {
  const norm = email.trim().toLowerCase();
  return withTenant(db, tenantId, async (tx) => {
    const r = await tx.query(`SELECT 1 FROM klient_avsandare WHERE email = $1`, [norm]);
    return Boolean(r.rows[0]);
  });
}
