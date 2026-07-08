# grundbok

**Arkitekturförslag + körbar vertikal skiva** för agentisk AI-bokföring på svenska villkor:
ett versionshanterat skills-bibliotek i stället för separata expertagenter, tenant-isolering
vid kunden (inte agenten), deterministisk policy-motor utanför LLM:en, och en append-only
verifikationsledger enligt bokföringslagen.

## Börja här

1. **[ULTRAPLAN.md](./ULTRAPLAN.md)** — tesen och arkitekturen. Läs den först.
2. **[ATTRIBUTION.md](./ATTRIBUTION.md)** — vad som lånas från vilka open source-projekt, och vilka svagheter i förlagorna som rättats.
3. **[DEMO.md](./DEMO.md)** — körordningen för demon, steg för steg.

## Kör skivan

```bash
npm install
cp .env.example .env.local   # valfritt: klistra in ANTHROPIC_API_KEY för live-AI
npm run dev                  # → http://localhost:3456
```

Med `ANTHROPIC_API_KEY` i `.env.local` tolkar riktig Anthropic (claude-opus-4-8, structured
output) underlagen. **Utan nyckel körs en deterministisk fallback med exakt samma schema** —
det är ett ärligt mock-läge, och UI:t visar vilket läge som gäller som en badge uppe till
höger. Faller API:t mitt i en körning går flödet automatiskt vidare i fallback.

```bash
npm test                # 37 tester — de 5 RLS-/append-only-testerna är skrivna för att visas live
npm run test:fallback   # verifierar den deterministiska fallbacken utan nät
```

## Vad skivan visar

- **Momssats som data, inte prompttext.** Satserna är versionerad, datumavgränsad data i
  `skills/se/moms/rules.json`. Ändra affärshändelsedatumet och förslaget räknas om live
  (6 % ↔ 12 % för kaffeexemplet); avviker dokumentet från regelverket flaggas det — det
  ersätts aldrig tyst.
- **Approval-gate med hash-bundet godkännande.** Konsultens godkännande binds till en
  SHA-256-hash av exakt det förslag som visades, plus konsultidentitet — inget blint
  approval-id.
- **RLS-isolering per kund.** Bokför hos kund A, byt till kund B: huvudboken är tom.
  Isoleringen är `FORCE ROW LEVEL SECURITY`-policyer i Postgres, inte appfilter.
- **Append-only ledger.** En riktig `UPDATE` mot en bokförd verifikation vägras av databasen
  (demo-knapp i UI:t); ändringar sker som rättelseposter med omvända rader och referens
  (BFL 5:5, BFNAR 2013:2).
- **Automatisk deterministisk fallback.** Samma schema, samma flöde, med eller utan
  LLM — och läget redovisas alltid öppet i UI:t.

## Struktur

```
ULTRAPLAN.md            arkitekturen och tesen — börja här
ATTRIBUTION.md          lånen + de rättade svagheterna
DEMO.md                 demokörordning
skills/se/              en skill = tre filer: SKILL.md (läsbar) + rules.json (exekverbar) + config.schema.json
agents/                 en expert = en manifest-fil (skills + verktyg + policy-gates), inte en kodbas
customers/              en kundinstans = config mot config.schema.json (mallar/ = branschmallar)
src/lib/                deterministisk motor: db med RLS + triggers, moms, kontering, policy, extraktion, ledger
src/app/                Next.js-UI + API-rutter
tests/                  37 tester, varav 5 RLS-/append-only-smoke-tester byggda för livevisning
```

## Design och ansvar

UI:t följer [Gesso](https://github.com/leopold-jpg/gesso)-designgrunden (`DESIGN.md` +
`design.tokens.css` i repot, self-hostade fonter). Och en princip bär hela systemet:
**allt det producerar är förslag.** Ingen rad bokförs utan att en konsult godkänt den —
gaten är arkitektur, inte en checkbox.
