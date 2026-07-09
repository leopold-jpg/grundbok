# grundbok

**Arkitekturförslag + körbart system** för agentisk AI-bokföring på svenska villkor:
ett versionshanterat skills-bibliotek i stället för separata expertagenter, ett
förslagskontrakt som enda skrivväg, tenant-isolering vid kunden (inte agenten),
deterministisk policy-motor utanför LLM:en, och en append-only verifikationsledger
enligt bokföringslagen.

## Börja här

1. **[docs/GRUNDBOK-MASTERPLAN.md](./docs/GRUNDBOK-MASTERPLAN.md)** — kartan: ytorna, lagren, roadmapen.
2. **[ULTRAPLAN.md](./ULTRAPLAN.md)** — tesen och grundarkitekturen.
3. **[docs/adr/](./docs/adr/README.md)** — besluten (förslagskontraktet, serverless-runtimen).
4. **[ATTRIBUTION.md](./ATTRIBUTION.md)** — vad som lånas varifrån, och vilka svagheter i förlagorna som rättats.
5. **[DEMO.md](./DEMO.md)** — demokörordningen, steg för steg.

## Fyra personer, fyra ytor

| Yta | Vem | Ser ALDRIG |
|---|---|---|
| **Publik sajt** (`/`) | Blivande kund | Riktig data |
| **Byråns arbetsyta** (`/byra`) | Byråns konsulter — attestkö, intag, chatt, logg, klientvy | Andra byråers data |
| **Operatörskonsolen** (`/operator`) | Grundaren — bolag, agenter, mallar, hälsa (aggregat) | Kvitton, attest, kunddata |
| **Kundappen** *(kommande, S3)* | Klientbolaget — fota kvitton, status, kundassistent | Konteringar, attestkön |

Regeln som bär allt: **attest bor hos byrån, drift hos operatören.**
Grundaren godkänner aldrig ett kvitto.

## Kör systemet

```bash
npm install
cp .env.example .env.local   # valfritt: klistra in ANTHROPIC_API_KEY för live-AI
npm run dev                  # → http://localhost:3456
```

Dev-inloggningar (lösenord `grundbok-dev`): konsult `konsult.ett@byran-exempel.se`,
operatör `leopold@otiva.se`. Lokal auth körs i PGlite bakom ett `AuthAdapter`-interface —
Supabase Auth tar över vid deploy som en adapterswap.

Med `ANTHROPIC_API_KEY` i `.env.local` tolkar riktig Anthropic (claude-opus-4-8, structured
output) underlagen. **Utan nyckel körs en deterministisk fallback med exakt samma schema** —
ett ärligt mock-läge; intaget visar alltid vilken motor som tolkade. Faller API:t mitt i en
körning går flödet automatiskt vidare i fallback.

```bash
npm test                # 116 tester: kontrakt, beslutsmotor, RLS/append-only, auth, ytor, gräns-smoke
npm run test:fallback   # verifierar den deterministiska fallbacken utan nät
python3 scripts/e2e.py  # 51 kontroller mot körande dev-server (färsk .data) — hela kedjan över HTTP
```

## Arkitekturen i en bild (text)

```
underlag in                    agenter (OpenClaw, cron-worker, UI-intag)
    │                                   │  Bearer gk_… (scopad nyckel)
    ▼                                   ▼
┌──────────────────────────────────────────────────────────────┐
│  PORTEN — POST /api/proposals (förslagskontraktet, ADR-0002) │
│  schema → principal → hash → injection-screening → idempotens│
└──────────────────────────┬───────────────────────────────────┘
                           ▼
        ┌──────────────────────────────────────┐
        │  BESLUTSMOTORN (kärnan, deterministisk)│
        │  autonomipolicy per tenant+modul       │
        │  inom policyn → auto (policybeslut)    │
        │  utanför → attestkön hos byrån         │
        │  correction → ALLTID människa          │
        └──────────────┬───────────────────────┘
                       ▼ decided_by = verifierat user-id
        ┌──────────────────────────────────────┐
        │  HUVUDBOKEN — append-only, FORCE RLS  │
        │  rättelse = ny verifikation m. referens│
        └──────────────────────────────────────┘

ytor:  /       publik — ingen riktig data
       /byra   byrån  — attest, intag, chatt, logg (kravKonsult + byrå-vakt)
       /operator operatören — aggregat, mallar, provisionering (kravOperator)
```

En byrå förvaltar flera klientbolag (`byraer` → `tenants`); konsultens session
scopar allt i `/byra`, och operatören ser antal — aldrig innehåll. Varje förslag
bär modell, promptversion, konfidens och lagrum (AI Act-spårbarhet).

## Vad systemet visar

- **Momssats som data, inte prompttext.** Versionerad, datumavgränsad data i
  `skills/se/moms/rules.json`. Byt affärshändelsedatum och förslaget räknas om live
  (6 % ↔ 12 % för kaffeexemplet); avvikelser mot underlaget flaggas — ersätts aldrig tyst.
- **Attest med hash-bunden, verifierad identitet.** Attesten binds till en SHA-256-hash
  av exakt det förslag som visades plus den inloggade konsultens user-id.
- **Policy som ratt.** "Bokför själv upp till X kr för kända motparter" — rutinhändelser
  auto-bokförs som loggade policybeslut, attesthögen krymper, correction kräver alltid människa.
- **RLS-isolering per kund + byrå-gräns i ytan.** FORCE ROW LEVEL SECURITY i databasen,
  byrå-vakt i API:t — URL-manipulation ger 403, smoke-testat.
- **En agent är en rad** (ADR-0003). Provisionering är en insert, pausning en statusändring
  (porten svarar 403), nyckelrotation ett enda flöde. Nyckeln kan föreslå, aldrig bokföra.
- **Automatisk deterministisk fallback.** Samma schema, samma flöde, med eller utan LLM.

## Struktur

```
docs/GRUNDBOK-MASTERPLAN.md  kartan — ytor, lager, roadmap
docs/adr/               arkitekturbesluten (0002 förslagskontraktet, 0003 runtimen)
ULTRAPLAN.md            tesen och grundarkitekturen
ATTRIBUTION.md          lånen + de rättade svagheterna
DEMO.md                 demokörordning (Mats-demon)
skills/se/              en skill = SKILL.md (läsbar) + rules.json (exekverbar) + config.schema.json
agents/                 en expert = en manifest-fil, inte en kodbas
customers/              en kundinstans = config (mallar/ = branschmallar)
src/contracts/          förslagskontraktet: typer, zod, kanonisk hash
src/lib/                kärnan: beslutsmotor, ledger, policy, kontering, moms, db (RLS + triggers)
src/modules/            moduler bakom porten (radgivning m. RAG)
src/workers/            generisk agent-worker + cron (ADR-0003)
src/auth/               AuthAdapter + session-krav (kravKonsult/kravOperator/byrå-vakt)
src/ytor/               ytlogik: leads, byra, operator
src/app/                Next.js — publik sajt, /byra, /operator, /login + API-rutter
tests/                  116 tester; scripts/e2e.py kör 51 kontroller över HTTP
```

## Design och ansvar

UI:t följer [Gesso](https://github.com/leopold-jpg/gesso)-designgrunden (`DESIGN.md` +
`design.tokens.css` i repot, self-hostade fonter), scopad CSS per yta. Och en princip
bär hela systemet: **allt det producerar är förslag.** Ingen rad bokförs utan att en
behörig människa attesterat den eller att kundens egen policy uttryckligen tillåtit
det — gaten är arkitektur, inte en checkbox.
