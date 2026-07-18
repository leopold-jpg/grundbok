# Kickoff-tillägg — mallkatalog & telemetri (WP11–WP13)

Fortsättning på CLAUDE-CODE-KICKOFF.md (WP1–7) och runtime-tillägget
(WP8–10). Repot är en flat Next.js-app — skapa ingen packages-struktur.

## Steg 0

1. Arbeta på branch `mallkatalog` (utgå från main efter senaste merge).
2. `0004-fast-mallkatalog-och-agenttelemetri.md` ligger i repo-roten:
   flytta till `docs/adr/`, uppdatera ADR-index i `docs/adr/README.md`.
   Committa separat: `docs: ADR-0004 fast mallkatalog + telemetri`.
3. Läs ADR-0002, 0003 och 0004 samt `agents/`, `skills/` och `AGENTS.md`
   — mallregistret ska följa repots befintliga agent-/skill-mönster.

Samma regler som tidigare: committa per arbetspaket, `npm test` grönt
mellan varje. Fråga innan något befintligt beteende rivs.

## WP11 — mallregistret som kod

Skapa mallregistret (placera enligt befintligt mönster, förslagsvis
`src/mallar/` eller under `agents/` om det passar repot bättre):

```ts
// registry.ts
export interface MallDefinition {
  id: ModuleId;                 // 'bokforing-bygg', 'lon', ...
  version: string;              // semver, t.ex. '1.0.0'
  displayName: string;
  systemPrompt: string;         // eller referens till promptfil
  regler: MallRegel[];          // ROT, omvänd byggmoms, etc.
  defaultPolicy: PolicyDefaults;
}
export const mallRegistret: Record<ModuleId, MallDefinition>;
```

Release ett innehåller fyra mallar som stubbar med korrekt struktur
(fullt promptinnehåll är nästa pass): `bokforing-bygg`,
`bokforing-restaurang`, `bokforing-konsult`, `lon`.

Golden-tester: per mall minst tre testfall (input-underlag → förväntad
Proposal-form). Testerna får gärna mocka LLM-svaret i detta pass —
poängen är att pipelinen mall → Proposal → kontraktvalidering är låst.

Stämpla `mallId` + `mallVersion` på varje Proposal (utöka kontraktet i
`src/contracts/proposal-contract.ts` bakåtkompatibelt, bumpa till v0.3
i headern och notera ändringen i ADR-0002:s changelog om sådan finns).

## WP12 — migration: mallversion + telemetrivy

1. Migration på `agents`:

```sql
alter table agents
  add column template_version text not null default '1.0.0';
-- agents.module refererar redan ModuleId = mallens id
```

Agenter pekar på major-version (`'1'` räcker som konvention om ni
föredrar det — välj en linje och dokumentera i migrationens kommentar).

2. Telemetri som VY, aldrig som räknarkolumner:

```sql
create view agent_telemetry as
select
  a.id as agent_id,
  a.tenant_id,
  a.module,
  a.template_version,
  a.status,
  count(p.id) filter (where p.created_at > now() - interval '7 days')
    as proposals_7d,
  count(p.id) filter (where p.status = 'auto_booked'
    and p.created_at > now() - interval '7 days') as auto_7d,
  count(p.id) filter (where p.status = 'corrected'
    and p.created_at > now() - interval '7 days') as corrected_7d,
  max(p.created_at) as last_activity
from agents a
left join proposals p on p.agent_id = a.id
group by a.id;
```

Anpassa statusvärdena till proposals-tabellens faktiska kolumner från
WP-arbetet — vyn ovan är formen, inte facit. RLS: samma tenant-scopade
läsning som `agents`.

## WP13 — flottöversikt i adminkonsolen

Ny adminvy (följ befintlig admin-layout):

- Tabell över alla agenter: namn, tenant, mall + version, status,
  förslag 7d, andel auto, andel korrigerade, senaste aktivitet
- Filtrering på mall och status; sortering på korrigeringsandel
  (hög andel = mallen eller kontexten behöver ses över)
- Radklick → agentdetalj: policyn, nyckelscopes, senaste 20 Proposals
- Varningsmarkering: agent utan aktivitet 7d, eller korrigeringsandel
  över tröskel (hårdkoda 30 % nu, gör konfigurerbart senare)

Ingen skrivfunktionalitet i denna vy utöver pausa/aktivera agent
(uppdaterar `agents.status`, redan stödd av auth-middlewaren).

## Klart när

- [ ] ADR-0004 i docs/adr/ + index uppdaterat
- [ ] Mallregister med fyra mallar + golden-tester gröna
- [ ] Proposal-kontraktet stämplar mallId + mallVersion (v0.3)
- [ ] Migration + agent_telemetry-vyn med RLS
- [ ] Flottöversikt renderar med riktiga data i dev
- [ ] `npm test` grönt, en commit per WP
