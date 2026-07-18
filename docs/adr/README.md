# Architecture Decision Records

Besluten som formar grundboks arkitektur — ett dokument per beslut, i
kronologisk ordning. Formatet följer ADR-konventionen: Context → Decision →
Alternatives Considered → Consequences.

**Statusar:** `proposed` tills beslutet är genomfört i kod, därefter
`accepted`; ersätts ett beslut markeras det `superseded by ADR-NNNN`.

## Index

| ADR | Beslut i en rad | Status |
|---|---|---|
| 0001 | *Reserverad* — v1-arkitekturens grundbeslut är dokumenterade i [ULTRAPLAN.md](../../ULTRAPLAN.md) och bryts ut hit om de behöver revideras | accepted |
| [0002 — Förslagskontrakt som enda skrivväg](./0002-forslagskontrakt-och-agentgrans.md) | Alla moduler och agenter når kärnan enbart via det versionerade `Proposal`-schemat; bara beslutsmotorn skriver till huvudboken — agenter är klienter med scopade nycklar | accepted |
| [0003 — Serverless multi-tenant runtime](./0003-serverless-multitenant-runtime.md) | En agent är en rad i databasen, inte en maskin: stateless workers servar alla tenants, provisionering är en insert, jobb flödar genom kö med pgmq-semantik | accepted |
| [0004 — Fast mallkatalog och agenttelemetri](./0004-fast-mallkatalog-och-agenttelemetri.md) | Mallar är fast versionerad kod i repot — ingen fritext per agent; kundunikhet bor i tenant-kontext och policy; telemetri härleds ur proposals via vy | accepted *(mallistan ersatt av ADR-0005)* |
| [0005 — Funktionsmallar med branschpaket](./0005-funktionsmallar-med-branschpaket.md) | Mallar är funktionsroller (`bokforing`, `lon`, `skatt-compliance`, `leverantorsreskontra`); branschregler är fristående paket som aktiveras via tenant-kontexten | accepted |

## Beslut som ännu bara finns i prosa

- **Byrå-nivån över tenants** och **AuthAdapter-mönstret** — WP11,
  [KICKOFF-YTOR.md](../../KICKOFF-YTOR.md)
- **Ytornas ansvarsfördelning** — *attest bor hos byrån, drift hos
  operatören* — [GRUNDBOK-MASTERPLAN.md](../GRUNDBOK-MASTERPLAN.md)

De bryts ut till egna ADR:er när de utmanas.
