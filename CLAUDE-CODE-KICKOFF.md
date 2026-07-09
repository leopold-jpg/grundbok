# Claude Code kickoff — grundbok v0.2: modulplattform

Repot är en flat Next.js-app (`src/`, `tests/`, `agents/`, `skills/`).
Skapa INTE någon packages-/monorepo-struktur.

## Steg 0 — innan något byggs

1. Skapa branch `modul-plattform` och arbeta där.
2. Två filer ligger i repo-roten: flytta `proposal-contract.ts` till
   `src/contracts/proposal-contract.ts` och
   `0002-forslagskontrakt-och-agentgrans.md` till
   `docs/adr/` (skapa mappen, lägg till en README.md-index enligt
   ADR-konvention). Committa flytten separat:
   `docs: förslagskontrakt v0.2 + ADR-0002`.
3. Läs ADR:n och kontraktet. Läs även `agents/`, `skills/` och `AGENTS.md`
   — rådgivningsmodulen ska följa det befintliga agent-/skill-mönstret
   i repot, inte införa ett nytt.

## Mål för sessionen

Refaktorera v1 så att den befintliga kvitto/faktura-tolkningen blir **modul #1
("bokforing")** bakom förslagskontraktet, och bygg **modul #2 ("radgivning")**
som första nya specialist. Ingen befintlig verifierad funktionalitet får
försämras — 37/37-testerna och e2e-kedjan ska fortsatt vara gröna.

## Arbetspaket (i ordning, committa per paket)

1. **Kontraktet in i kärnan.** Lägg `proposal-contract.ts` i
   `src/contracts/`. Zod-scheman för runtime-validering av
   Proposal + Decision. Kanoniserad JSON-serialisering för hash (sortera
   nycklar, ören som heltal) — samma funktion på agent- och kärnsida.

2. **`POST /api/proposals` + beslutsmotor.** Endpoint validerar kontrakt,
   verifierar hash, kör injection-screening (återanvänd v1:s), matchar mot
   AutonomyPolicy: träff → auto_approve + bokför via befintlig verifierings-
   pipeline; miss → status `pending` i godkännandekön. Decision-tabell med
   FK till proposal, append-only precis som verifications.

3. **Migrera v1-flödet.** Dagens tolkning → kontering ska producera en
   Proposal och gå genom samma endpoint som externa agenter. UI:ts
   "Godkänn och bokför" blir en Decision. Ta bort alla andra vägar till
   ledgern. e2e-testerna uppdateras men behåller samma assertions.

4. **API-nycklar med scopes.** Tabell `agent_keys` (tenant_id, module,
   scopes[], hashad nyckel). Middleware: nyckelns tenant måste matcha
   proposalens tenant_id, modulen måste matcha, scope `proposals:write`
   krävs. RLS på allt.

5. **Rådgivningsmodulen.** Ny mapp `src/modules/radgivning/` (eller under
   `agents/` om det matchar repots befintliga mönster bättre — följ det
   som redan finns):
   RAG över BAS-kontoplan + ML (2023:200) + BFN:s allmänna råd (seed:a med
   de källfiler vi redan citerar). Producerar `advisory_answer`-proposals
   med lagrum och konfidens — läsande, `human_oversight_default: false`.
   Scope: endast `proposals:write` + `ledger:read` (för kontosaldofrågor,
   tenant-scopat).

6. **Adminkonsol v0.** Ny route `/admin`: godkännandekö (pending proposals
   per tenant med summary, konfidens, lagrum, diff mot policy), policy-
   editor för AutonomyPolicy per modul, beslutslogg. Samma studio-skin.

7. **Smoke-tester för gränsen.** Testa att: agent-nyckel utan rätt scope
   nekas; proposal med manipulerad hash nekas; auto_approve respekterar
   max_belopp och correction-undantaget; tenant A:s nyckel kan inte skapa
   förslag för tenant B.

## OpenClaw-integration (separat session, men designa för det nu)

- Agenter hos kund kör stateless: hämtar underlag (mejl/foto), bygger
  Proposal, POST:ar. Ingen lokal state, ingen DB-åtkomst, ingen hemlighet
  utöver sin scopade nyckel.
- Nyckelrotation per agent via adminkonsolen (revoke = raden inaktiveras).
- `provenance.agent_runtime` sätts så vi kan skilja OpenClaw-körningar
  från interna i beslutsloggen.

## Icke-mål denna session

Löner, bokslut, vision-input (fota kvitto). Kontraktet ska bara *rymma* dem
(payroll_run/adjustment finns i typerna, batch_id finns).
