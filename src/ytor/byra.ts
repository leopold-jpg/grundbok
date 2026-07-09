import type { PGlite } from "@electric-sql/pglite";
import type { Sessionsinfo } from "@/auth/adapter";
import { tenantsForSession } from "@/auth/session";
import { hamtaKo, hamtaBeslutslogg, type KoRad, type LoggRad } from "@/lib/admin";

// Byråns arbetsyta (WP13) — ytlogik ovanpå kärnans läshjälpare. Allt är
// scopat genom sessionens byrå: klientlistan kommer ALLTID ur
// tenantsForSession, aldrig ur requesten. "alla"-läget för kö och logg
// är en loop över byråns klienter — ingen ny fråga utan tenant-kontext.

export type Klient = { id: string; namn: string; mall: string };

export type ByraKoRad = KoRad & { tenant_id: string; tenant_namn: string };
export type ByraLoggRad = LoggRad & {
  tenant_id: string;
  tenant_namn: string;
  /** Uppslaget namn för decided_by: konsultens namn, "autonomipolicyn"
   *  för policy-beslut, annars råvärdet (äldre data). */
  beslutad_av: string;
  policy_beslut: boolean;
};

/** Löser vilka klienter som ska frågas: en specifik (efter byrå-vakt i
 *  routen) eller byråns alla. Okänd tenant → tom lista, aldrig fel som
 *  läcker om tenanten finns hos någon annan byrå. */
async function valdaKlienter(
  db: PGlite,
  session: Sessionsinfo,
  val: string,
): Promise<Klient[]> {
  const alla = await tenantsForSession(db, session);
  if (val === "alla") return alla;
  return alla.filter((t) => t.id === val);
}

export async function attestKo(
  db: PGlite,
  session: Sessionsinfo,
  val: string,
): Promise<ByraKoRad[]> {
  const klienter = await valdaKlienter(db, session, val);
  const rader: ByraKoRad[] = [];
  for (const k of klienter) {
    const ko = await hamtaKo(db, k.id);
    rader.push(...ko.map((r) => ({ ...r, tenant_id: k.id, tenant_namn: k.namn })));
  }
  rader.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return rader;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function beslutsLogg(
  db: PGlite,
  session: Sessionsinfo,
  val: string,
  limit = 50,
): Promise<ByraLoggRad[]> {
  const klienter = await valdaKlienter(db, session, val);
  const rader: (LoggRad & { tenant_id: string; tenant_namn: string })[] = [];
  for (const k of klienter) {
    const logg = await hamtaBeslutslogg(db, k.id, limit);
    rader.push(...logg.map((r) => ({ ...r, tenant_id: k.id, tenant_namn: k.namn })));
  }
  rader.sort((a, b) => b.decided_at.localeCompare(a.decided_at));
  const toppen = rader.slice(0, limit);

  // Namn-uppslag av decided_by mot users — en fråga för hela sidan.
  const ids = [...new Set(toppen.map((r) => r.decided_by).filter((v) => UUID_RE.test(v)))];
  const namn = new Map<string, string>();
  if (ids.length > 0) {
    const r = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM users WHERE id = ANY($1)`,
      [ids],
    );
    for (const u of r.rows) namn.set(u.id, u.name);
  }

  return toppen.map((r) => {
    const policyBeslut = r.decided_by.startsWith("policy:");
    return {
      ...r,
      policy_beslut: policyBeslut,
      beslutad_av: policyBeslut
        ? "autonomipolicyn"
        : (namn.get(r.decided_by) ?? r.decided_by),
    };
  });
}

/** Läsvy över klientens agenter — byråns konsult ser vad som är igång,
 *  aldrig nyckelhashar eller drift-detaljer (det är operatörens yta). */
export async function klientAgenter(
  db: PGlite,
  tenantId: string,
): Promise<{ id: string; display_name: string; module: string; status: string; created_at: string }[]> {
  const r = await db.query<{
    id: string;
    display_name: string;
    module: string;
    status: string;
    created_at: Date | string;
  }>(
    `SELECT id, display_name, module, status, created_at
     FROM agents WHERE tenant_id = $1 ORDER BY created_at`,
    [tenantId],
  );
  return r.rows.map((a) => ({
    ...a,
    created_at: (a.created_at instanceof Date ? a.created_at : new Date(a.created_at)).toISOString(),
  }));
}
