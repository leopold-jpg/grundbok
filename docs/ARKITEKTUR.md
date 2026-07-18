# Arkitektur — teknisk översikt

Kort orientering för en ny utvecklare. Detaljerna och motiven bor i
[ADR:erna](./adr/README.md); det här är kartan över hur delarna hänger ihop.

## Kontraktet — enda vägen in ([ADR-0002](./adr/0002-forslagskontrakt-och-agentgrans.md))

Allt som vill påverka huvudboken — moduler, externa agenter, UI-intag —
skickar ett versionerat `Proposal`-schema till `POST /api/proposals`
("porten"). Porten kör i ordning: schemavalidering → principal-uppslag →
kanonisk SHA-256-hash → injection-screening → idempotenskontroll.

Endast kärnans **beslutsmotor** skriver till huvudboken, och den är
deterministisk: förslag inom tenantens autonomipolicy auto-bokförs som
loggade policybeslut; förslag utanför hamnar i byråns attestkö; en
`correction` kräver alltid människa. Attesten binds till en hash av exakt
det förslag som visades plus den inloggade konsultens user-id
(`decided_by` = verifierad identitet).

Varje förslag bär modell, promptversion, konfidens och lagrum, så
spårbarheten (AI Act) genereras som biprodukt av flödet — den är inte ett
separat dokumentationssteg.

Kod: `src/contracts/` (typer, zod, kanonisk hash), `src/lib/` (beslutsmotor,
ledger, policy).

## Control plane — en agent är en rad ([ADR-0003](./adr/0003-serverless-multitenant-runtime.md))

Agentkoden deployas en gång som stateless workers och servar alla tenants.
En "agent" är en rad i tabellen `agents`: tenant, modul/mallreferens,
policy-ref, scopad nyckel, status. Därmed:

- **Provisionering** = en insert (~1 sekund, Stripe-förberedd webhook).
- **Pausning** = en statusändring — porten svarar 403 för pausad agent.
- **Nyckelrotation** = ett enda flöde; nyckeln (`gk_…`) kan föreslå,
  aldrig bokföra, och visas bara en gång vid utfärdandet.

Jobb flödar genom en kö med pgmq-semantik och per-tenant concurrency-tak
(skydd mot bullriga grannar). Agentlogiken är rena funktioner
(input → `Proposal`), så samma kod kör i molnet (prod) och i OpenClaw (dev).
Control plane (agents, policys, nycklar) är tydligt skild från data plane
(workers).

Vad en agent är bestäms av mallkatalogen: fast, versionerad kod i repot
([ADR-0004](./adr/0004-fast-mallkatalog-och-agenttelemetri.md)) skuren i
funktionsroller med branschpaket aktiverade via tenant-kontexten
([ADR-0005](./adr/0005-funktionsmallar-med-branschpaket.md)). Agenten äger
aldrig egna instruktioner; kundunikhet bor i tenant-kontexten och policyn.

Kod: `src/workers/` (generisk worker + cron), `agents/` (manifest),
`skills/` (SKILL.md + rules.json per skill).

## RLS-modellen — isolering på dataplanet

Tenant-isoleringen vilar på databasen, inte på applikationskod:

- **FORCE ROW LEVEL SECURITY** per tenant på datat; huvudboken är dessutom
  append-only via triggers — en rättelse är en ny verifikation med referens,
  aldrig en ändrad rad.
- **Byrå-nivån ovanpå tenants** (`byraer` → `tenants`): en byrå förvaltar
  flera klientbolag. Konsultens session scopar allt i `/byra`, och en
  byrå-vakt i API:t gör att URL-manipulation mot en annan byrås data ger 403.
- **Rollerna skär ytorna**: byråns konsulter ser attest, intag och logg för
  sina klienter; operatören ser aggregat (antal, hälsa) men aldrig kvitton,
  attest eller kunddata. Regeln: *attest bor hos byrån, drift hos operatören.*
- **Agentnycklarna är scopade** till tenant + modul och har ingen
  databasåtkomst alls — en läckt nyckel kan bara skapa förslag.

Eftersom runtimen är delad (ADR-0003) är RLS + nyckelscopes hela
isoleringsgarantin; gräns-smoke-testerna i `tests/` är därför permanenta
regressionstester, inte engångskontroller.

Kod: `src/lib/db` (RLS + triggers), `src/auth/` (AuthAdapter,
kravKonsult/kravOperator, byrå-vakt).

## Telemetrin — härledd, aldrig lagrad ([ADR-0004](./adr/0004-fast-mallkatalog-och-agenttelemetri.md))

Varje agents utfall mäts via telemetri **härledd ur proposals-datat genom en
vy** — räknare lagras aldrig på agentraden, så telemetrin kan inte drifta
ifrån verkligheten. Vyn läses tenant-scopad (security invoker), och
`agents` + telemetrivyn ger operatörskonsolens flottöversikt utan extra
skrivvägar. Eftersom varje `Proposal` stämplas med mallversion kan varje
bokföringsbeslut spåras till exakt mallversion + tenant-kontext.

## Läs vidare

- [GRUNDBOK-MASTERPLAN.md](./GRUNDBOK-MASTERPLAN.md) — ytorna, lagren, roadmapen
- [adr/](./adr/README.md) — besluten med alternativ och konsekvenser
- [../ULTRAPLAN.md](../ULTRAPLAN.md) — tesen och grundarkitekturen
