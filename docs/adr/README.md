# Architecture Decision Records

Beslut som formar grundboks arkitektur, ett dokument per beslut, i kronologisk
ordning. Formatet följer ADR-konventionen: Context → Decision → Alternatives
Considered → Consequences. Status är `proposed` tills beslutet är genomfört i
kod, därefter `accepted`; ersätts ett beslut markeras det `superseded by ADR-NNNN`.

| ADR | Titel | Status |
|---|---|---|
| 0001 | *(reserverad — v1-arkitekturens grundbeslut är dokumenterade i [ULTRAPLAN.md](../../ULTRAPLAN.md); de bryts ut hit om de behöver revideras)* | accepted |
| [0002](./0002-forslagskontrakt-och-agentgrans.md) | Förslagskontrakt som enda skrivväg — agenter är klienter | accepted |
| [0003](./0003-serverless-multitenant-runtime.md) | Serverless multi-tenant runtime — en agent är en rad, inte en maskin | accepted *(WP8–WP10, PR #1)* |
| [0004](./0004-fast-mallkatalog-och-agenttelemetri.md) | Fast mallkatalog och agenttelemetri — mallar är versionerad kod, telemetri härleds ur proposals | accepted *(WP11–WP13; release-ett-mallistan ersatt av ADR-0005)* |
| [0005](./0005-funktionsmallar-med-branschpaket.md) | Funktionsmallar med branschpaket — mallar är funktionsroller, branschregler är regelpaket via tenant-kontexten | accepted |

Beslut som än så länge bara är dokumenterade i prosa: byrå-nivån över tenants
och AuthAdapter-mönstret (WP11, [KICKOFF-YTOR.md](../../KICKOFF-YTOR.md)) samt
ytornas ansvarsfördelning — *attest bor hos byrån, drift hos operatören* —
([GRUNDBOK-MASTERPLAN.md](../GRUNDBOK-MASTERPLAN.md)). De bryts ut till egna
ADR:er när de utmanas.
