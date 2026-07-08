-- grundbok: append-only-regelns andra lager (ULTRAPLAN §7).
-- Trigger-mönstret lånar ClawKeepers audit-immutabilitet (MIT, se ATTRIBUTION.md).
-- Även kod som kör med högre rättigheter än grundbok_app kan inte ändra
-- eller radera bokförda poster — rättelse sker genom särskild rättelsepost.

CREATE OR REPLACE FUNCTION grundbok_forbjud_andring() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION USING
    message = 'Bokförda poster får inte ändras eller raderas (BFL 5 kap. 5 § + BFNAR 2013:2). Skapa en rättelsepost med referens till den rättade verifikationen.',
    errcode = 'P0001';
END
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'verifications', 'verification_rows', 'approvals', 'audit_log'
  ] LOOP
    EXECUTE format($f$
      CREATE TRIGGER enforce_append_only
        BEFORE UPDATE OR DELETE ON %I
        FOR EACH ROW EXECUTE FUNCTION grundbok_forbjud_andring()
    $f$, t);
  END LOOP;
END $$;
