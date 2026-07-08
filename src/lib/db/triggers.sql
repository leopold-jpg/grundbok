-- grundbok: append-only-regelns andra lager (ULTRAPLAN §7).
-- Trigger-mönstret lånar ClawKeepers audit-immutabilitet (MIT, se ATTRIBUTION.md).
-- Även kod som kör med högre rättigheter än grundbok_app kan inte ändra
-- eller radera bokförda poster eller beslut — rättelse sker genom
-- särskild rättelsepost, omprövning genom nytt förslag.
--
-- Filen är idempotent (DROP TRIGGER IF EXISTS före CREATE): migrate()
-- kör den vid varje uppstart.

CREATE OR REPLACE FUNCTION grundbok_forbjud_andring() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION USING
    message = 'Bokförda poster och beslut får inte ändras eller raderas (BFL 5 kap. 5 § + BFNAR 2013:2). Skapa en rättelsepost respektive ett nytt förslag.',
    errcode = 'P0001';
END
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'verifications', 'verification_rows', 'approvals', 'audit_log',
    'decisions'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS enforce_append_only ON %I', t);
    EXECUTE format($f$
      CREATE TRIGGER enforce_append_only
        BEFORE UPDATE OR DELETE ON %I
        FOR EACH ROW EXECUTE FUNCTION grundbok_forbjud_andring()
    $f$, t);
  END LOOP;
END $$;
