# HANDOFF — S2 (ytor + auth), avbruten efter WP11

*Skriven 2026-07-09 när sessionens kontext tog slut. Nästa session: läs denna,
KICKOFF-YTOR.md och docs/GRUNDBOK-MASTERPLAN.md — fortsätt från WP12.*

## Exakt läge

Branch **`ytor`** (från main, PR #1 mergad). Commits i ordning:

1. `ci:` — GitHub Actions (npm test + npm run build på varje PR mot main,
   bygget med GRUNDBOK_FORCE_FALLBACK=1). Committad FÖRST per instruktion.
2. `docs:` — masterplanen till docs/, KICKOFF-YTOR.md incheckad.
3. `WP11:` — **komplett, inte partiell** (ingen "del 1" behövdes):
   **103/103 tester, produktionsbygget grönt** vid avlämning.

### WP11 — klart i sin helhet

- **Schema (additivt i src/lib/db — undantag avstämt med Leopold):**
  `byraer` (byrå-nivå ÖVER tenants), `tenants.byra_id`, `users` (scrypt),
  `memberships` (konsult per byrå), `sessions` (sha256-hashade tokens, 12 h).
  Auth-tabellerna är service-vägens plan: inga app-grants, ingen RLS —
  byrå-scopningen upprätthålls i src/auth/ och ska smoke-testas i WP15.
- **src/auth/**: `adapter.ts` (AuthAdapter-interface — Supabase-bytet vid
  deploy är en adapterswap, samma mönster som Ko), `pglite-auth.ts`
  (login/logout/session), `session.ts` (kravKonsult, kravOperator,
  tenantsForSession, kravTenantIByra = byrå-vakten, SESSION_COOKIE).
- **middleware.ts** (repo-rot): /byra/* och /operator/* utan cookie →
  /login. OBS: edge kan inte nå PGlite — middlewaren kollar BARA att
  cookien finns; riktig verifiering sker server-side i varje route.
- **/login** + /api/auth/{login,logout,session}.
- **decided_by = user-id:** /api/beslut, /api/admin/beslut och
  /api/rattelse kräver konsult-session, tar identiteten ur sessionen och
  vaktar tenant-mot-byrå. **Avsiktlig konsekvens:** gamla demo-UI:t
  (page.tsx) och v0-admin kan inte längre attestera — de ersätts i
  WP12/WP13. scripts/e2e.py är därför RÖD tills WP15 skriver om den med
  login-flöde (unit-sviten är grön; e2e körs mot dev-server).
- **Dev-seed** (idempotent i client.ts): Byrån Exempel AB förvaltar
  kund_a + kund_b; konsult.ett@/konsult.tva@byran-exempel.se
  ("Konsult Ett/Två Exempel" — avstämt fiktiva); operator Leopold Seifert
  <leopold@otiva.se>. Alla dev-lösenord: `grundbok-dev`.

### Kända fel / granskningspunkter

- `src/app/api/admin/beslut/route.ts` skrevs om via skript efter ett
  Write-verktygsfel ("File has not been read yet"). Omskrivningen är
  test- och byggverifierad, men ögna filen i nästa session.
- `next-env.d.ts` får en autogenererad diff av Next vid dev-körning —
  harmlös, incheckad i handoff-commiten för rent träd.
- Två parallella agenter startades för WP12 (publik sajt) och WP14
  (operatörskonsolen) i worktrees under `.claude/worktrees/` (gitignorerade,
  syns via `git worktree list`). **Båda dog** (API-avbrott resp. stall)
  — deras eventuella delarbete är OINTEGRERAT och OCOMMITTAT. Granska
  eller släng worktrees; utgå från spec-texterna nedan i stället.

## Designbeslut nästa session MÅSTE respektera

1. **Kärnan fryst:** src/lib + src/contracts ändras inte. Enda undantag
   (avstämt): additiva tillägg i src/lib/db/ (schema/rls/seed). Ny ytlogik
   läggs i **src/ytor/** (ny yta), inte i src/lib.
2. **CSS-scoping:** globals.css är fryst. Varje yta får egen scopad fil
   enligt admin.css-mönstret: publik.css/`.publik`, byra.css/`.byra`,
   operator.css/`.operator`. Studio-skinnet (DESIGN.md, tokens) bär allt.
3. **Upphovsman är Leopold Seifert** — hitta aldrig på namn, siffror,
   citat eller påståenden. Fiktiva exempel i repots Exempel-stil är OK
   (avstämt). LICENSE rättades på main efter ett tidigare namnfel.
4. Schema-DDL från delpaket: append-only i schema.sql med tydlig
   WP-kommentar; nya tabeller för auth/leads/mallar är service-vägens
   plan (inga app-grants) om de inte är tenant-data.
5. Attest-språk i byråns UI ("att attestera", "attesterad"), aldrig
   "proposals". Operatören ser ALDRIG förslags-innehåll — bara aggregat
   (masterplanens regel: attest bor hos byrån, drift hos operatören).

## Återstående paket (spec i KICKOFF-YTOR.md)

- **WP12 — publik sajt (/):** ersätt page.tsx (demoflödet flyttar till
  /byra, gamla finns i git-historiken). Hero/så-funkar-det med statisk
  attestkö-mock (exakta belopp ur src/lib/exempel.ts), moduler ärligt
  märkta, kontaktbox → ny tabell `leads` (service-väg, DDL append) via
  src/ytor/leads.ts + POST /api/leads, sidfot (GitHub-länk + AI Act-
  mening + /login-länk). Mobil först.
- **WP13 — byråns arbetsyta (/byra):** planerad arkitektur (opåbörjad,
  inga filer skrivna): src/ytor/byra.ts (attestKo per tenant/'alla' via
  src/lib/admin.ts-hjälparna, beslutsLogg med namn-uppslag av decided_by
  mot users, klientVy) + /api/byra/* (klienter, ko, intag/tolka,
  intag/forslag, chatt, logg, klient/verifikationer, klient/agenter
  läsvy, klient/policy trösklar) — ALLA med kravKonsult + kravTenantIByra.
  UI: klientväljare (+ "alla klienter" för kö/logg), attestkön (flytta
  admin-JSX:en, byt språk), underlag-intag (gamla page.tsx-flödet inkl.
  datumväxlarknapparna), chatten (svaraPaFraga, historik i
  sessionStorage per user räcker), beslutslogg, klientvy (verifikationer
  + rättelse, agenter läsvy, policy: "bokför själv upp till X kr för
  kända motparter"). Befintliga /api/beslut och /api/rattelse (WP11-
  gatade) återanvänds för attest/rättelse.
- **WP14 — operatörskonsolen (/operator):** ny tabell policy_mallar
  (DDL append + seed av "Bygg — försiktig"/"Restaurang — standard" i
  schema.sql), src/ytor/operator.ts (bolagsoversikt = AGGREGAT, mallar-
  CRUD, halsa via agent_jobs, provisioneraMedMall → provisionAgent),
  /api/operator/* med kravOperator, OCH operator-gata befintliga
  /api/agents + /api/agents/[id]. UI: bolag → agenter (provisionera med
  mallval, nyckel visas en gång, rotation som ETT flöde), mallar, hälsa.
  Därefter rivning: /admin → redirect /operator; gamla demo-API:er
  (/api/tolka, /api/forslag, /api/verifikationer, /api/radgivning,
  /api/exempel, /api/status, /api/demo/tamper) och /api/admin/* rivs när
  /byra tagit över (kön/loggen bor då i /byra).
- **WP15 — gräns-smoke:** byrå A ser aldrig byrå B (URL-manipulation),
  operator nekas förslags-INNEHÅLL, oinloggad → redirect (publik +
  /api/proposals med nyckel opåverkade), decided_by alltid riktigt
  user-id (attest utan session omöjlig). Skriv också om **scripts/e2e.py**
  (bevarad hit från sessionens scratchpad) mot de nya ytorna med
  login-flöde, och kör den mot dev-servern innan push.

## Regler för resten av S2 (oförändrade)

Committa per paket, npm test grönt mellan varje, pusha när allt är grönt,
öppna PR mot main, **merga inte**. Stanna och fråga Leopold om något i
kärnan verkar behöva röras.
