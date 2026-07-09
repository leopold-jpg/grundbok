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

-- Verifikationstabellens kolumner ÄR lagkravens fält (BFL 5 kap. 7 §):
-- sammanställningsdatum, affärshändelsedatum, vad, belopp (via rader),
-- motpart, underlagshänvisning, verifikationsnummer.
CREATE TABLE IF NOT EXISTS verifications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            text NOT NULL REFERENCES tenants(id),
  nummer               integer NOT NULL,
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

-- Control plane (WP8, ADR-0003): en agent är en RAD, inte en maskin.
-- Ersätter/absorberar agent_keys från WP4. Provisionering = insert;
-- avstängning = statusändring. Nyckeln lagras enbart som sha256-hash.
-- AVVIKELSE från ADR-utkastets SQL: tenants.id är text i kärnan (inte
-- uuid), och autonomy_policies har komposit-PK — den får därför ett
-- stabilt uuid-id nedan som FK-mål för agents.policy_id.
ALTER TABLE autonomy_policies ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS autonomy_policies_id_idx ON autonomy_policies (id);

CREATE TABLE IF NOT EXISTS agents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      text NOT NULL REFERENCES tenants(id),
  module         text NOT NULL,
  display_name   text NOT NULL,
  key_hash       text NOT NULL UNIQUE,
  scopes         text[] NOT NULL,
  policy_id      uuid REFERENCES autonomy_policies(id),
  status         text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'paused', 'canceled')),
  -- Per-tenant concurrency-tak i jobb-kön (ADR-0003: bullrig granne).
  max_concurrency integer NOT NULL DEFAULT 2,
  provisioned_by text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz
);

-- WP8 absorberar WP4-tabellen (lokal dev — ingen data att migrera).
DROP TABLE IF EXISTS agent_keys;

-- Data plane-kön (WP9, ADR-0003). Lokalt en tabell med pgmq-semantik
-- (visibility timeout + archive) bakom interfacet i src/lib/queue.ts —
-- i Supabase byts implementationen mot pgmq utan att worker-koden rörs.
-- Inga app-grants och ingen RLS: kön är service-vägens interna dataplan;
-- meddelandet bär tenant_id och payload_ref är en storage-URI, aldrig
-- rå underlagsdata.
CREATE TABLE IF NOT EXISTS agent_jobs (
  msg_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message     jsonb NOT NULL,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  vt          timestamptz NOT NULL DEFAULT now(),
  read_ct     integer NOT NULL DEFAULT 0,
  archived_at timestamptz
);

-- WP3-rivningen: v1:s suggestions/approvals ersätts helt av
-- proposals/decisions — en väg in, en sanning (ADR-0002). Idempotent
-- uppgradering av databaser skapade före v0.2.
ALTER TABLE IF EXISTS verifications DROP COLUMN IF EXISTS suggestion_id;
DROP TABLE IF EXISTS approvals;
DROP TABLE IF EXISTS suggestions;

-- ============================================================ S2 ====
-- Auth och organisation (WP11, KICKOFF-YTOR): en byrå förvaltar flera
-- klientbolag (tenants). Auth-tabellerna är service-vägens plan — inga
-- app-grants, ingen RLS: uppslag sker innan tenant-kontexten finns
-- (samma princip som agents-uppslaget), och byrå-scopningen upprätthålls
-- i auth-lagret (src/auth/) + smoke-testas i WP15.

CREATE TABLE IF NOT EXISTS byraer (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namn        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS byra_id uuid REFERENCES byraer(id);

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  -- Lokal dev-auth (scrypt). Vid deploy tar Supabase Auth över inloggningen
  -- bakom samma AuthAdapter-interface — kolumnen blir då oanvänd.
  password_hash text NOT NULL,
  is_operator   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  user_id    uuid NOT NULL REFERENCES users(id),
  byra_id    uuid NOT NULL REFERENCES byraer(id),
  role       text NOT NULL DEFAULT 'konsult' CHECK (role IN ('konsult')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, byra_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- Publika sajtens kontaktbox (WP12, KICKOFF-YTOR). Leads är operatörens
-- data — aldrig tenant-data: service-vägens plan, inga app-grants, ingen
-- RLS (samma princip som auth-tabellerna ovan). Ingen mejlintegration nu.
CREATE TABLE IF NOT EXISTS leads (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namn       text NOT NULL,
  byra       text NOT NULL,
  email      text NOT NULL,
  meddelande text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Operatörskonsolen (WP14): namngivna policymallar som väljs vid
-- provisionering och KOPIERAS till tenantens autonomy_policies — mallen
-- är operatörens data (service-vägens plan, inga app-grants), tenantens
-- policyrad förblir kärnans enda sanning. Grund för branschmallar i S5.
CREATE TABLE IF NOT EXISTS policy_mallar (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namn                   text NOT NULL UNIQUE,
  module                 text NOT NULL,
  max_belopp_ore         bigint NOT NULL CHECK (max_belopp_ore >= 0),
  min_confidence         numeric NOT NULL CHECK (min_confidence BETWEEN 0 AND 1),
  kanda_motparter_endast boolean NOT NULL,
  tillatna_kinds         jsonb NOT NULL DEFAULT '[]',
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- Startmallar (redigerbara i konsolen): bygg är helt manuell (omvänd
-- betalningsskyldighet ska alltid attesteras), restaurang auto-bokför
-- rutinköp upp till 2 000 kr från kända motparter.
INSERT INTO policy_mallar
  (namn, module, max_belopp_ore, min_confidence, kanda_motparter_endast, tillatna_kinds)
VALUES
  ('Bygg — försiktig', 'bokforing', 0, 1, true, '[]'),
  ('Restaurang — standard', 'bokforing', 200000, 0.85, true, '["journal_entry"]')
ON CONFLICT (namn) DO NOTHING;
