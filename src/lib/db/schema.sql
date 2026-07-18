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

-- ================================================= mallkatalog (WP12) ====
-- ADR-0004: en agent är en instans av (mall, mallversion). Agentraden
-- PEKAR på mallens major-version — konventionen är '1', inte '1.0.0':
-- minor/patch följer med automatiskt vid deploy, ny major är ett
-- medvetet migrationssteg. Den EXAKTA versionen stämplas i stället på
-- varje Proposal (payloadens mall_version, kontrakt v0.3).
--
-- template_id läggs till utöver kickoff-skissen: mallens id är INTE ett
-- ModuleId (mallen 'leverantorsreskontra' instansierar modulen
-- 'bokforing'; ADR-0005: mallar är funktionsroller), så module-kolumnen
-- ensam kan inte identifiera mallen. NULL = agent provisionerad utan
-- mall (före mallkatalogen, eller rå modul-agent). Branschpaket lagras
-- INTE på agentraden — de härleds ur tenants.mall (tenant-kontexten
-- aktiverar, ADR-0005), så en branschändring hos tenanten slår igenom
-- utan agentmigration.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS template_id text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS template_version text NOT NULL DEFAULT '1';

-- Telemetrin behöver veta VILKEN agent som skapade förslaget — kolumnen
-- är en läsoptimering på samma sätt som module/kind (payload är sanningen
-- för kontraktsfälten, men agentidentiteten är portens kunskap, inte
-- agentens egen utsaga). NULL = internt UI-flöde utan agentrad.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES agents(id);

-- Telemetri som VY, aldrig räknarkolumner (ADR-0004: härled alltid ur
-- proposals — lagrade räknare ruttnar). DROP + CREATE i stället för
-- CREATE OR REPLACE: OR REPLACE vägrar ändrad kolumnuppsättning, och
-- filen körs om vid varje uppstart; rls.sql återställer grants efteråt.
--
-- Statusvärdena är proposals faktiska (pending/auto_approved/approved/
-- rejected — kickoffens 'auto_booked' finns inte). "Korrigerad" är inte
-- en status utan rättelsekedjan: förslagets verifikation har rättats av
-- en senare verifikation (rattar_verifikation). rejected_7d räknas
-- separat — båda är kvalitetssignaler för mallen, med olika tyngd.
--
-- security_invoker: en vy exekverar annars med ägarens rättigheter och
-- skulle kringgå RLS. Med invoker gäller tenant_isolation på agents,
-- proposals och verifications rakt igenom vyn — samma tenant-scopade
-- läsning som agents. Service-vägen (operatören) ser hela flottan.
DROP VIEW IF EXISTS agent_telemetry;
CREATE VIEW agent_telemetry WITH (security_invoker = true) AS
SELECT
  a.id AS agent_id,
  a.tenant_id,
  a.module,
  a.template_id,
  a.template_version,
  a.display_name,
  a.status,
  count(p.id) FILTER (WHERE p.created_at > now() - interval '7 days')
    AS proposals_7d,
  count(p.id) FILTER (WHERE p.status = 'auto_approved'
    AND p.created_at > now() - interval '7 days')                    AS auto_7d,
  count(p.id) FILTER (WHERE p.status = 'rejected'
    AND p.created_at > now() - interval '7 days')                    AS rejected_7d,
  count(p.id) FILTER (WHERE p.created_at > now() - interval '7 days'
    AND EXISTS (
      SELECT 1 FROM verifications v
      JOIN verifications r ON r.rattar_verifikation = v.id
      WHERE v.proposal_id = p.id
    ))                                                               AS corrected_7d,
  max(p.created_at) AS last_activity
FROM agents a
LEFT JOIN proposals p ON p.agent_id = a.id
GROUP BY a.id;

-- ======================================== underlagsjakten (WP33) ====
-- Kompletteringskön: det klienten är skyldig byrån — saknade kvitton
-- (skapas automatiskt ur missing_receipt-flaggade förslag) och
-- konsultens frågor till kunden. Kunddatabärande: tenant_id + RLS som
-- övriga. Status är arbetsflöde (open → paminnd → klar) — raden är
-- arbetsdata, inte räkenskapsinformation, och får uppdateras.
CREATE TABLE IF NOT EXISTS kompletteringar (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      text NOT NULL REFERENCES tenants(id),
  agent_id       uuid REFERENCES agents(id),
  proposal_id    uuid NOT NULL REFERENCES proposals(id),
  typ            text NOT NULL CHECK (typ IN ('missing_receipt', 'fraga')),
  belopp_ore     bigint,
  beskrivning    text NOT NULL,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paminnd', 'klar')),
  -- Kundens/konsultens registrerade svar — när det sätts blir raden klar
  -- och svaret fästs vid förslaget i audit-loggen (Rex-dokumentation).
  svar           text,
  skapad         timestamptz NOT NULL DEFAULT now(),
  senast_paminnd timestamptz
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
