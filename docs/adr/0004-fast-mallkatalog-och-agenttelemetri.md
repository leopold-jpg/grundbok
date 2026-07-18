# ADR-0004: Fast mallkatalog och agenttelemetri

**Datum**: 2026-07-18
**Status**: accepted
**Beslutsfattare**: Leopold + Claude

## Context

Agenter provisioneras ur mallar (ADR-0003). Öppen fråga: får mallens
instruktioner skrivas fritt per agent/kund, eller är katalogen fast?
Grundbok ska skeppas som ett färdigt system där varje agents beteende
går att förklara, testa och supporta. Fritt redigerbara hjärnor per
kund gör det omöjligt att svara på "varför bokförde agenten så här?"
och omöjligt att regressionstesta.

## Decision

Mallkatalogen är fast och versionerad kod i repot. En agent är alltid
en instans av `(mall, mallversion)` — agentraden refererar mallen, den
äger aldrig egna instruktioner. Kundunikhet bor uteslutande i
tenant-kontexten (kontoplan, historik, korrigeringar) och i
autonomipolicyn. Varje agents utfall mäts via telemetri härledd ur
proposals-datat, så hela flottan kan överblickas i adminkonsolen.

## Alternatives Considered

### Alternativ 1: Fritt redigerbara instruktioner per agent
- **Pros**: Maximal flexibilitet, konsulten kan skräddarsy allt
- **Cons**: Ingen kan garantera vad systemet gör; varje agent blir en
  unik snöflinga utan tester; support och felsökning skalar inte
- **Why not**: Bryter mot "skeppa som klart system". Kan bli
  enterprise-tillval senare, bakom egen prisnivå och eget ansvar.

### Alternativ 2: Mallar som redigerbara rader i databasen
- **Pros**: Ändringar utan deploy, adminvänligt
- **Cons**: Malltext driftar ifrån CI och golden-tester; versions-
  hantering blir hemmabygge; prod kan avvika från det som testats
- **Why not**: Mallens kvalitet garanteras av att den går genom samma
  pipeline som all annan kod — PR, test, deploy.

### Alternativ 3: Fast mall + fritt "tilläggsprompt"-fält per agent
- **Pros**: Liten ventil för specialfall
- **Cons**: Bakdörr som urholkar hela garantin — all supportbarhet
  försvinner via det fältet
- **Why not**: Specialfall ska lösas i tenant-kontext eller policy.
  Räcker inte det är det en ny mallversion, inte ett fritextfält.

## Consequences

### Positive
- En deploy uppgraderar alla agenter av samma mall hos alla kunder
- Varje bokföringsbeslut kan spåras till exakt mallversion + kontext
- Golden-tester per mall blir permanenta regressionstester
- Flottöversikt gratis: `agents` + telemetrivy = instrumentpanel

### Negative
- Kundönskemål om avvikande beteende kräver mallrelease, inte en
  snabbfix i admin — långsammare, men avsiktligt
- Mallversion måste stämplas på varje Proposal för spårbarheten

### Risks
- Mallversionsdrift (agent pekar på version som inte längre finns i
  koden) → agenter pekar på major-version, minor/patch följer med
  automatiskt vid deploy; borttagen major kräver migrationssteg
- Telemetri som uppdaterbara kolumner ruttnar → härled alltid ur
  proposals via vy, lagra aldrig räknare på agentraden
