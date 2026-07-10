# ADR-0003: Serverless multi-tenant runtime — en agent är en rad, inte en maskin

**Date**: 2026-07-08
**Status**: accepted *(genomförd i kod: WP8–WP10, PR #1 — agents-tabellen, kö med pgmq-semantik, generisk worker, provisionering)*
**Deciders**: Leopold, Love

## Context

Specialistagenter ska deployas till kundbolag. Konkurrerande modell i branschen
är per-kund-instanser (dedikerade Linux-maskiner per klient). Vi vill kunna
provisionera en ny agent för en klient på sekunder, låta kunden själv köpa
fler agenter via self-service, och aldrig vara beroende av lokal hårdvara
(Mac mini/OpenClaw är utvecklingsmiljö, inte produktens runtime).

## Decision

Agentkoden deployas EN gång som stateless workers i molnet (Vercel-funktioner
+ Supabase Edge Functions/cron) och servar alla tenants. En "agent" är en rad
i tabellen `agents` (tenant, modul, policy-ref, scopad nyckel, status).
Provisionering = insert. Avstängning = statusändring. Jobb flödar genom en
kö i Supabase (pgmq). Inferensen köps per anrop från Anthropic API — ingen
egen modell-compute.

## Alternatives Considered

### Alternative 1: Per-kund-instanser (dedikerad maskin/container per klient)
- **Pros**: Hård isolering per kund; enkelt att resonera om
- **Cons**: Provisionering tar timmar/dagar; linjär drift- och hårdvarukostnad;
  uppdatering av agentkod = N deployer; self-service omöjligt
- **Why not**: Skalar med människotimmar, inte med kod. RLS + scopade nycklar
  ger redan tenant-isolering på dataplanet.

### Alternative 2: OpenClaw på egen hårdvara som produktions-runtime
- **Pros**: Finns redan; full kontroll
- **Cons**: Single point of failure för alla kunders bokföring; ingen
  elasticitet; blandar personlig infra med kundleverans
- **Why not**: OpenClaw behålls som dev/test-orkestrerare. Agenterna skrivs
  som rena funktioner (input → Proposal) så samma kod kör i båda miljöerna.

### Alternative 3: Dedikerad jobbplattform (Inngest/Trigger.dev) från start
- **Pros**: Retries, observability, långa kedjor out of the box
- **Cons**: Extra beroende innan volymen motiverar det
- **Why not**: Skjuts upp. pgmq + cron räcker för pilot. Worker-interfacet
  designas så plattform kan läggas ovanpå utan att röra agentkoden.

## Consequences

### Positive
- "Ny agent för en kund" = en databastransaktion (~1 sekund), körbar från
  adminkonsolen eller en Stripe-webhook → self-service-köp av agenter
- En kodbas, en deploy, alla kunder får förbättringar samtidigt
- Kostnad följer användning (inferens per förslag), inte antal kunder
- control plane (agents/policys/nycklar/billing) tydligt skild från
  data plane (workers)

### Negative
- Serverless-tidsgränser kräver att långa körningar (lönebatch) delas i
  jobb per rad/anställd — batch_id i kontraktet hanterar grupperingen
- Delad runtime ⇒ tenant-isoleringen vilar helt på RLS + nyckelscopes —
  smoke-testerna i WP7 blir permanenta regressionstester

### Risks
- Bullrig granne (en tenants volym sinkar andra) → kö med per-tenant
  concurrency-tak från start
- Kund kräver on-prem-modell → hanteras som enterprise-tillval via
  Bedrock/Vertex EU-region den dag någon betalar för det
