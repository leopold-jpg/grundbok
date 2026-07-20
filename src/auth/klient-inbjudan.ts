import { randomBytes } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { sha256Hex } from "@/contracts";
import { withTenant } from "@/lib/db/tenant";
import { auditera } from "@/lib/ledger";
import { hashLosenord } from "./pglite-auth";

// Klientinbjudan (WP20): byråns konsult bjuder in klientbolagets
// användare från klientvyn. Engångstoken (gi_…) lagras enbart som
// sha256-hash; inlösen är atomär (used_at-claim) så en länk aldrig kan
// ge två konton. All åtkomst går på service-vägen — precis som övriga
// auth-uppslag sker den innan någon tenant-kontext finns.

const TOKEN_PREFIX = "gi_";
const GILTIGHET_DYGN = 7;
const SESSION_LIVSLANGD_TIMMAR = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_LOSENORD = 8;

export type NyInbjudan = {
  id: string;
  /** Klartexttoken — visas EN gång (länken); endast hashen lagras. */
  token: string;
  utgar: string;
};

export async function skapaKlientInbjudan(
  db: PGlite,
  input: { tenantId: string; email: string; skapadAv: string },
): Promise<NyInbjudan> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error("Ogiltig e-postadress");

  const token = TOKEN_PREFIX + randomBytes(24).toString("base64url");
  const r = await db.query<{ id: string; expires_at: Date | string }>(
    `INSERT INTO klient_inbjudningar (tenant_id, email, token_hash, skapad_av, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))
     RETURNING id, expires_at`,
    [input.tenantId, email, sha256Hex(token), input.skapadAv, GILTIGHET_DYGN],
  );
  const rad = r.rows[0];

  await withTenant(db, input.tenantId, (tx) =>
    auditera(tx, input.tenantId, "klient_inbjudan_skapad", {
      inbjudanId: rad.id,
      email,
      skapadAv: input.skapadAv,
    }),
  );

  return {
    id: rad.id,
    token,
    utgar: (rad.expires_at instanceof Date
      ? rad.expires_at
      : new Date(rad.expires_at)
    ).toISOString(),
  };
}

export type GiltigInbjudan = { tenant_id: string; tenant_namn: string; email: string };

/** Token → inbjudan om den är okonsumerad och inom giltighetstiden;
 *  annars null (en utgången eller använd länk är död). */
export async function hamtaKlientInbjudan(
  db: PGlite,
  token: string,
): Promise<GiltigInbjudan | null> {
  if (!token?.startsWith(TOKEN_PREFIX)) return null;
  const r = await db.query<GiltigInbjudan>(
    `SELECT i.tenant_id, t.namn AS tenant_namn, i.email
     FROM klient_inbjudningar i
     JOIN tenants t ON t.id = i.tenant_id
     WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at > now()`,
    [sha256Hex(token)],
  );
  return r.rows[0] ?? null;
}

/** Inlösen: kunden sätter namn + lösenord → users-rad, klient-membership
 *  och en inloggad session i ETT steg. Tokenclaimen är atomär
 *  (UPDATE … WHERE used_at IS NULL RETURNING) — två samtidiga inlösen av
 *  samma länk kan aldrig ge två konton. */
export async function losInKlientInbjudan(
  db: PGlite,
  input: { token: string; namn: string; losenord: string },
): Promise<{ sessionToken: string; tenantId: string }> {
  const namn = input.namn.trim();
  if (!namn) throw new Error("Namn krävs");
  if ((input.losenord ?? "").length < MIN_LOSENORD) {
    throw new Error(`Lösenordet måste vara minst ${MIN_LOSENORD} tecken`);
  }
  if (!input.token?.startsWith(TOKEN_PREFIX)) {
    throw new Error("Inbjudningslänken är ogiltig eller har gått ut");
  }

  // Förkontrollerna körs FÖRE den atomära claimen: ett förutsägbart
  // misslyckande (kontot finns, bolaget saknar byrå) får inte konsumera
  // engångslänken. users.email UNIQUE är backstoppen för kapplöpningen.
  const kandidat = await db.query<{ tenant_id: string; email: string }>(
    `SELECT tenant_id, email FROM klient_inbjudningar
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [sha256Hex(input.token)],
  );
  if (!kandidat.rows[0]) throw new Error("Inbjudningslänken är ogiltig eller har gått ut");

  const tenant = await db.query<{ byra_id: string | null }>(
    `SELECT byra_id FROM tenants WHERE id = $1`,
    [kandidat.rows[0].tenant_id],
  );
  if (!tenant.rows[0]?.byra_id) {
    throw new Error("Klientbolaget saknar byrå — kontakta er konsult");
  }

  const befintlig = await db.query(`SELECT 1 FROM users WHERE email = $1`, [
    kandidat.rows[0].email,
  ]);
  if (befintlig.rows[0]) {
    throw new Error("Ett konto med den e-postadressen finns redan — logga in i stället");
  }

  const claim = await db.query<{ id: string; tenant_id: string; email: string }>(
    `UPDATE klient_inbjudningar SET used_at = now()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING id, tenant_id, email`,
    [sha256Hex(input.token)],
  );
  const inbjudan = claim.rows[0];
  if (!inbjudan) throw new Error("Inbjudningslänken är ogiltig eller har gått ut");

  const user = await db.query<{ id: string }>(
    `INSERT INTO users (email, name, password_hash, is_operator)
     VALUES ($1, $2, $3, false) RETURNING id`,
    [inbjudan.email, namn, hashLosenord(input.losenord)],
  );
  await db.query(
    `INSERT INTO memberships (user_id, byra_id, role, tenant_id)
     VALUES ($1, $2, 'klient', $3)`,
    [user.rows[0].id, tenant.rows[0].byra_id, inbjudan.tenant_id],
  );

  const sessionToken = "gs_" + randomBytes(32).toString("base64url");
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [sha256Hex(sessionToken), user.rows[0].id, SESSION_LIVSLANGD_TIMMAR],
  );

  await withTenant(db, inbjudan.tenant_id, (tx) =>
    auditera(tx, inbjudan.tenant_id, "klient_inbjudan_anvand", {
      inbjudanId: inbjudan.id,
      email: inbjudan.email,
      userId: user.rows[0].id,
    }),
  );

  return { sessionToken, tenantId: inbjudan.tenant_id };
}

export type KlientAnvandare = { id: string; email: string; namn: string; created_at: string };
export type InbjudanRad = {
  id: string;
  email: string;
  skapad: string;
  utgar: string;
  anvand: boolean;
};

/** Klientvyens läsning (WP24): vilka klientanvändare och inbjudningar
 *  finns för tenanten. Byrå-vakten görs i routen (kravTenantIByra). */
export async function listaKlientAnvandare(
  db: PGlite,
  tenantId: string,
): Promise<{ anvandare: KlientAnvandare[]; inbjudningar: InbjudanRad[] }> {
  const iso = (v: Date | string) => (v instanceof Date ? v : new Date(v)).toISOString();
  const anvandare = await db.query<{
    id: string;
    email: string;
    name: string;
    created_at: Date | string;
  }>(
    `SELECT u.id, u.email, u.name, m.created_at
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.role = 'klient' AND m.tenant_id = $1
     ORDER BY m.created_at`,
    [tenantId],
  );
  const inbjudningar = await db.query<{
    id: string;
    email: string;
    created_at: Date | string;
    expires_at: Date | string;
    used_at: Date | string | null;
  }>(
    `SELECT id, email, created_at, expires_at, used_at
     FROM klient_inbjudningar WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [tenantId],
  );
  return {
    anvandare: anvandare.rows.map((u) => ({
      id: u.id,
      email: u.email,
      namn: u.name,
      created_at: iso(u.created_at),
    })),
    inbjudningar: inbjudningar.rows.map((i) => ({
      id: i.id,
      email: i.email,
      skapad: iso(i.created_at),
      utgar: iso(i.expires_at),
      anvand: i.used_at !== null,
    })),
  };
}
