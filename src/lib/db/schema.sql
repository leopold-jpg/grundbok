-- grundbok: datamodell (ULTRAPLAN §7)
-- Alla kunddatabärande tabeller bär tenant_id — utan undantag.
-- verifications/verification_rows är räkenskapsinformation: append-only.

CREATE TABLE IF NOT EXISTS tenants (
  id          text PRIMARY KEY,
  namn        text NOT NULL,
  mall        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text NOT NULL REFERENCES tenants(id),
  raw         text NOT NULL,
  typ         text NOT NULL DEFAULT 'kvitto',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suggestions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      text NOT NULL REFERENCES tenants(id),
  document_id    uuid REFERENCES documents(id),
  -- Hela förslaget: tolkade fält, konteringsrader, momsbeslut, lagrum
  payload        jsonb NOT NULL,
  -- SHA-256 av kanonisk JSON av payload. Godkännandet binds till denna —
  -- ändras förslaget efter godkännande är godkännandet ogiltigt (ULTRAPLAN §3).
  hash           text NOT NULL,
  engine         text NOT NULL CHECK (engine IN ('anthropic', 'fallback')),
  skill_versions jsonb NOT NULL DEFAULT '{}',
  flaggor        jsonb NOT NULL DEFAULT '[]',
  status         text NOT NULL DEFAULT 'vantar'
                 CHECK (status IN ('vantar', 'godkand', 'avvisad', 'bokford')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approvals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL REFERENCES tenants(id),
  suggestion_id   uuid NOT NULL REFERENCES suggestions(id),
  beslut          text NOT NULL CHECK (beslut IN ('godkand', 'avvisad')),
  -- Hashen av EXAKT det förslag konsulten såg när beslutet fattades
  suggestion_hash text NOT NULL,
  godkand_av      text NOT NULL,
  kommentar       text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Verifikationstabellens kolumner ÄR lagkravens fält (BFL 5 kap. 7 §):
-- sammanställningsdatum, affärshändelsedatum, vad, belopp (via rader),
-- motpart, underlagshänvisning, verifikationsnummer.
CREATE TABLE IF NOT EXISTS verifications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            text NOT NULL REFERENCES tenants(id),
  nummer               integer NOT NULL,
  suggestion_id        uuid REFERENCES suggestions(id),
  affarshandelsedatum  date NOT NULL,
  sammanstalld_at      timestamptz NOT NULL DEFAULT now(),
  beskrivning          text NOT NULL,
  motpart              text NOT NULL,
  underlag_document_id uuid REFERENCES documents(id),
  -- Rättelse sker genom ny verifikation med referens hit — aldrig UPDATE/DELETE
  -- (BFL 5 kap. 5 § + BFNAR 2013:2)
  rattar_verifikation  uuid REFERENCES verifications(id),
  skill_versions       jsonb NOT NULL DEFAULT '{}',
  extern_ref           text,
  UNIQUE (tenant_id, nummer)
);

CREATE TABLE IF NOT EXISTS verification_rows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL REFERENCES tenants(id),
  verification_id uuid NOT NULL REFERENCES verifications(id),
  konto           text NOT NULL,
  kontonamn       text NOT NULL DEFAULT '',
  debet_ore       bigint NOT NULL DEFAULT 0 CHECK (debet_ore >= 0),
  kredit_ore      bigint NOT NULL DEFAULT 0 CHECK (kredit_ore >= 0)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text NOT NULL REFERENCES tenants(id),
  event_type  text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
