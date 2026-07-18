-- grundbok: Row Level Security — andra försvarslinjen (ULTRAPLAN §2).
-- Mönstret lånar ClawKeepers RLS-struktur (MIT, se ATTRIBUTION.md) med tre
-- medvetna korrigeringar av deras svagheter:
--   1. Tenant-kontexten sätts transaktionsscopat med parametriserad
--      set_config('app.tenant_id', $1, true) — aldrig session-SET på delad pool.
--      (Sker i src/lib/db/tenant.ts, inte här.)
--   2. FORCE ROW LEVEL SECURITY — inte bara ENABLE.
--   3. Appen kör som icke-ägande roll UTAN BYPASSRLS (grundbok_app).
--
-- Filen är idempotent: migrate() kör den vid varje uppstart så att nya
-- tabeller får sina policyer utan att befintlig data behöver nollställas.

DO $$ BEGIN
  CREATE ROLE grundbok_app NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT USAGE ON SCHEMA public TO grundbok_app;

-- Rättighetsmodellen ÄR append-only-regelns första lager:
-- ingen UPDATE/DELETE på räkenskapsinformation eller beslut.
GRANT SELECT                 ON tenants           TO grundbok_app;
GRANT SELECT, INSERT         ON documents         TO grundbok_app;
GRANT SELECT, INSERT         ON verifications     TO grundbok_app;
GRANT SELECT, INSERT         ON verification_rows TO grundbok_app;
GRANT SELECT, INSERT         ON audit_log         TO grundbok_app;

-- v0.2: förslagskontraktet. Förslag är arbetsdata (status/flaggor får
-- uppdateras); beslut är append-only.
GRANT SELECT, INSERT           ON proposals         TO grundbok_app;
GRANT UPDATE (status, flaggor) ON proposals         TO grundbok_app;
GRANT SELECT, INSERT           ON decisions         TO grundbok_app;
GRANT SELECT, INSERT, UPDATE   ON autonomy_policies TO grundbok_app; -- policy-editorn i adminkonsolen
-- agents (WP8): tenant-scopad LÄSNING för appen; all skrivning går via
-- kärnans service-väg (superuser-anslutningen utanför withTenant — den
-- lokala motsvarigheten till Supabase service role).
GRANT SELECT ON agents TO grundbok_app;
-- agent_telemetry (WP12): vyn har security_invoker, så tenant_isolation
-- på agents/proposals/verifications gäller rakt igenom — grant:en ger
-- appen samma tenant-scopade läsning som agents. Vyn DROP+CREATE:as i
-- schema.sql vid varje uppstart; grant:en här återställs direkt efter.
GRANT SELECT ON agent_telemetry TO grundbok_app;
-- kompletteringar (WP33): arbetsdata — status/svar/påminnelse får
-- uppdateras, raderas aldrig (spårbarheten mot förslaget ska bestå).
GRANT SELECT, INSERT ON kompletteringar TO grundbok_app;
GRANT UPDATE (status, svar, senast_paminnd) ON kompletteringar TO grundbok_app;

-- RLS på varje kunddatabärande tabell: rad synlig/skrivbar ⇔ rätt tenant_id.
-- current_setting(..., true) returnerar NULL om osatt → policyn nekar allt.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'documents', 'verifications', 'verification_rows', 'audit_log',
    'proposals', 'decisions', 'autonomy_policies', 'agents',
    'kompletteringar'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format($f$
        CREATE POLICY tenant_isolation ON %I
          FOR ALL
          USING (tenant_id = current_setting('app.tenant_id', true))
          WITH CHECK (tenant_id = current_setting('app.tenant_id', true))
      $f$, t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;

-- tenants saknar tenant_id-kolumn: konsulten (byrån) ser sina kunder i
-- växlaren. I flerbyrå-drift scopas även denna tabell (byra_id + RLS).
