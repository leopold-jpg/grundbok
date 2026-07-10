import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { sha256Hex } from "@/contracts";
import type { AuthAdapter, Sessionsinfo } from "./adapter";

// Lokal auth-implementation (WP11): users/sessions i PGlite, scrypt-hashade
// lösenord, tokens lagrade som sha256-hash. All åtkomst går på kärnans
// service-väg — auth sker innan tenant-kontexten finns (samma princip
// som agents-uppslaget); RLS skyddar allt dataarbete som följer.

const SESSION_LIVSLANGD_TIMMAR = 12;

export function hashLosenord(losenord: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(losenord, salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifieraLosenord(losenord: string, lagrad: string): boolean {
  const [schema, salt, hash] = lagrad.split("$");
  if (schema !== "scrypt" || !salt || !hash) return false;
  const kandidat = scryptSync(losenord, salt, 32);
  const facit = Buffer.from(hash, "hex");
  return kandidat.length === facit.length && timingSafeEqual(kandidat, facit);
}

export class PgliteAuth implements AuthAdapter {
  constructor(private db: PGlite) {}

  async login(email: string, password: string): Promise<{ token: string } | null> {
    const r = await this.db.query<{ id: string; password_hash: string }>(
      `SELECT id, password_hash FROM users WHERE email = $1`,
      [email.trim().toLowerCase()],
    );
    const user = r.rows[0];
    if (!user || !verifieraLosenord(password, user.password_hash)) return null;

    const token = "gs_" + randomBytes(32).toString("base64url");
    await this.db.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, now() + make_interval(hours => $3))`,
      [sha256Hex(token), user.id, SESSION_LIVSLANGD_TIMMAR],
    );
    return { token };
  }

  async logout(token: string): Promise<void> {
    await this.db.query(`DELETE FROM sessions WHERE token_hash = $1`, [sha256Hex(token)]);
  }

  async session(token: string): Promise<Sessionsinfo | null> {
    if (!token?.startsWith("gs_")) return null;
    const r = await this.db.query<{
      id: string;
      email: string;
      name: string;
      is_operator: boolean;
      byra_id: string | null;
      byra_namn: string | null;
      role: string | null;
    }>(
      // LIMIT 1 utan ORDER BY gav icke-deterministisk byrå för användare
      // med flera memberships (Bugbot PR #2): äldsta membershipet vinner,
      // byrå-namn som tiebreak om timestamps är identiska.
      // TODO S3: byråväxlare vid login — konsulten VÄLJER byrå i stället
      // för att alltid landa i den äldsta.
      `SELECT u.id, u.email, u.name, u.is_operator,
              m.byra_id, b.namn AS byra_namn, m.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN memberships m ON m.user_id = u.id
       LEFT JOIN byraer b ON b.id = m.byra_id
       WHERE s.token_hash = $1 AND s.expires_at > now()
       ORDER BY m.created_at ASC NULLS LAST, b.namn ASC NULLS LAST
       LIMIT 1`,
      [sha256Hex(token)],
    );
    const rad = r.rows[0];
    if (!rad) return null;
    return {
      user: {
        id: rad.id,
        email: rad.email,
        name: rad.name,
        is_operator: rad.is_operator,
      },
      byra:
        rad.byra_id && rad.byra_namn
          ? { id: rad.byra_id, namn: rad.byra_namn, role: "konsult" }
          : null,
    };
  }
}
