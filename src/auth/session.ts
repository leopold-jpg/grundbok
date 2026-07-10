import type { PGlite } from "@electric-sql/pglite";
import { PgliteAuth } from "./pglite-auth";
import type { Sessionsinfo } from "./adapter";

// Serverhjälpare för ytornas gating (WP11). Next-middleware kan inte nå
// PGlite (edge) — den kollar bara att cookien finns och redirectar;
// den RIKTIGA verifieringen sker här, i route handlers och layouts.

export const SESSION_COOKIE = "grundbok_session";

export function tokenUrCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export async function sessionFranRequest(
  db: PGlite,
  req: Request,
): Promise<Sessionsinfo | null> {
  const token = tokenUrCookieHeader(req.headers.get("cookie"));
  if (!token) return null;
  return new PgliteAuth(db).session(token);
}

export type Kravfel = { http: 401 | 403; fel: string };

/** Konsultyta (/byra): kräver inloggad användare MED byrå-membership. */
export async function kravKonsult(
  db: PGlite,
  req: Request,
): Promise<{ session: Sessionsinfo } | Kravfel> {
  const session = await sessionFranRequest(db, req);
  if (!session) return { http: 401, fel: "inloggning krävs" };
  if (!session.byra) return { http: 403, fel: "konsultroll (byrå-membership) krävs" };
  return { session };
}

/** Operatörsyta (/operator): kräver operator-flaggan. */
export async function kravOperator(
  db: PGlite,
  req: Request,
): Promise<{ session: Sessionsinfo } | Kravfel> {
  const session = await sessionFranRequest(db, req);
  if (!session) return { http: 401, fel: "inloggning krävs" };
  if (!session.user.is_operator) return { http: 403, fel: "operatörsroll krävs" };
  return { session };
}

/** Konsultens klientbolag: tenants kopplade till sessionens byrå.
 *  Detta är byrå-gränsen — allt i /byra scopas genom denna lista. */
export async function tenantsForSession(
  db: PGlite,
  session: Sessionsinfo,
): Promise<{ id: string; namn: string; mall: string }[]> {
  if (!session.byra) return [];
  const r = await db.query<{ id: string; namn: string; mall: string }>(
    `SELECT id, namn, mall FROM tenants WHERE byra_id = $1 ORDER BY namn`,
    [session.byra.id],
  );
  return r.rows;
}

/** Vakt: hör tenanten till sessionens byrå? (URL-manipulation, WP15.) */
export async function kravTenantIByra(
  db: PGlite,
  session: Sessionsinfo,
  tenantId: string,
): Promise<boolean> {
  const tenants = await tenantsForSession(db, session);
  return tenants.some((t) => t.id === tenantId);
}
