# ADR-0002: Förslagskontrakt som enda skrivväg — agenter är klienter

**Date**: 2026-07-08
**Status**: proposed
**Deciders**: Leopold, Love

## Context

Grundbok v1 bevisade kedjan kvitto → tolkning → kontering → hash-bundet godkännande →
append-only-verifikation med RLS-isolering. Nästa steg är specialistmoduler (löner,
skatt/juridik, bokslut, rådgivning) och agenter som deployas hos kundbolag, sannolikt
orkestrerade via OpenClaw. Risken är att varje ny modul bygger sin egen väg in i
huvudboken och att ansvarskedjan urholkas.

## Decision

Alla moduler och externa agenter kommunicerar med kärnan uteslutande genom
**förslagskontraktet**: ett versionerat schema (`Proposal`) som skickas till
`POST /api/proposals`. Endast kärnans beslutsmotor (policy-auto-godkännande eller
mänskligt hash-bundet beslut) skriver till huvudboken. Agenter — inklusive
OpenClaw-körda — får modul- och tenant-scopade API-nycklar utan databasåtkomst.

## Alternatives Considered

### Alternative 1: Agenter med direkt DB-åtkomst (egna Supabase-kreds per modul)
- **Pros**: Snabbare att bygga per modul, ingen API-yta att underhålla
- **Cons**: Ansvarskedjan kan kringgås; RLS-policys måste dupliceras per modul;
  en komprometterad agent hos en kund = komprometterad ledger
- **Why not**: Bryter ansvarsprincipen som är produktens kärnvärde och AI Act-moaten

### Alternative 2: OpenClaw som betrodd orkestrerare med ledger-skrivrätt
- **Pros**: Färre hopp, agenterna kan bokföra "själva"
- **Cons**: Flyttar förtroendet från reviderbar kärna till agent-runtime;
  omöjligt att revidera vilken modell/prompt som fattade vilket beslut
- **Why not**: Autonomi ska vara en policyinställning i kärnan, inte en egenskap
  hos agenten

## Consequences

### Positive
- Ny specialistmodul = implementera kontraktet, ingen ombyggnad av kärnan
- Autonominivå (auto-bokför vs kö) styrs per tenant/kategori i kärnan, inte i agentkod
- Varje förslag bär modell, promptversion, konfidens och lagrum → AI Act-dokumentation
  genereras som biprodukt
- Agenter hos kundbolag är stateless och utbytbara; läckt agentnyckel kan bara
  skapa förslag, aldrig bokföra

### Negative
- API-versionering av kontraktet måste skötas disciplinerat (semver på schemat)
- Läsande moduler (rådgivning) behöver en separat, read-only query-yta

### Risks
- Kontraktet blir för smalt för löner (periodiska körningar, många rader) →
  mitigeras med `lines[]` utan övre gräns och `batch_id` från start
