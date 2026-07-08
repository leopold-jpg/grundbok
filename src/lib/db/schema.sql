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

-- ============================================================ v0.2 ====
-- Förslagskontraktet (ADR-0002): alla moduler — interna som OpenClaw-
-- agenter hos kund — skriver via proposals. Endast beslutsmotorn rör
-- huvudboken.

CREATE TABLE IF NOT EXISTS proposals (
  -- id sätts av AGENTEN (uuid) och är idempotensnyckel: samma förslag
  -- POST:at två gånger blir en dubblett-referens, aldrig två förslag.
  id          uuid PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id),
  module      text NOT NULL,
  kind        text NOT NULL,
  batch_id    text,
  -- Hela kontraktsobjektet som det validerades. Kolumnerna ovan/nedan är
  -- läs-/köoptimeringar; payload är sanningen och hash binder den.
  payload     jsonb NOT NULL,
  hash        text NOT NULL,
  confidence  numeric NOT NULL,
  summary     text NOT NULL,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'auto_approved', 'approved', 'rejected')),
  flaggor     jsonb NOT NULL DEFAULT '[]',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Besluten är append-only precis som verifikationerna: ett beslut kan
-- aldrig ändras i efterhand, bara följas av nya förslag.
CREATE TABLE IF NOT EXISTS decisions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL REFERENCES tenants(id),
  proposal_id         uuid NOT NULL REFERENCES proposals(id),
  -- Hash av EXAKT den payload beslutet avsåg — omräknad vid beslutet,
  -- inte kopierad blint från proposals.hash.
  proposal_hash       text NOT NULL,
  outcome             text NOT NULL
                      CHECK (outcome IN ('auto_approved', 'approved', 'rejected')),
  decided_by          text NOT NULL,
  decided_at          timestamptz NOT NULL DEFAULT now(),
  verifikationsnummer integer,
  reason              text
);

-- Autonominivån bor i KÄRNAN, aldrig i agenten (ADR-0002): per tenant
-- och modul. Allt som inte matchar auto_approve hamnar i godkännandekön.
CREATE TABLE IF NOT EXISTS autonomy_policies (
  tenant_id              text NOT NULL REFERENCES tenants(id),
  module                 text NOT NULL,
  max_belopp_ore         bigint NOT NULL DEFAULT 0,
  min_confidence         numeric NOT NULL DEFAULT 1,
  kanda_motparter_endast boolean NOT NULL DEFAULT true,
  tillatna_kinds         jsonb NOT NULL DEFAULT '[]',
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, module)
);

-- Verifikationen spårar vilket förslag (och därmed vilket beslut,
-- vilken modell, vilken skill-version) som skapade den.
ALTER TABLE verifications ADD COLUMN IF NOT EXISTS proposal_id uuid REFERENCES proposals(id);
