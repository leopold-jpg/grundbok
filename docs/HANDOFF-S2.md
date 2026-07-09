# S2 KLAR

*Skriven 2026-07-09 vid passets slut. Hela S2 (WP11–WP15) plus demo/dokumentation
och polering är genomförd, verifierad och pushad. PR #2 är öppen mot main —
INTE mergad (enligt instruktion).*

## Läget

Branch **`ytor`**, PR **#2**: *v0.3: ytor — auth, publik sajt, byråns arbetsyta,
operatörskonsol* (github.com/leopold-jpg/grundbok/pull/2).

**Verifiering vid avlämning:**
- `npm test` — **116/116** gröna (kontrakt, beslutsmotor, RLS/append-only, auth,
  leads, byra, operator, ytor-smoke + hela v0.2-sviten)
- `npm run build` — grönt (med `GRUNDBOK_FORCE_FALLBACK=1`, samma som CI)
- `python3 scripts/e2e.py` mot färsk dev-databas — **54/54** gröna,
  motor: **anthropic** (live-AI-vägen verifierad)

## Commits i passet (efter WP11/handoff från förra sessionen)

1. `docs:` kundappen som fjärde yta + S3 utökad (nya masterplanen → docs/)
2. `WP12:` publik sajt — hero, attestkö-mock, moduler (kundappen som kommande),
   kontaktbox → `leads`
3. `WP13:` byråns arbetsyta — attestkö/intag/chatt/beslutslogg/klientvy +
   **fix: middleware.ts flyttad till src/** (i repo-roten ignorerades den tyst
   av Next pga src/-katalogen — redirecten utan cookie fungerade aldrig förrän nu)
4. `WP14:` operatörskonsolen — policy_mallar, aggregat-översikt, rotation som
   ETT flöde, hälsa; v0-admin riven (/admin → redirect /operator; gamla
   demo-API:erna tolka/forslag/verifikationer/radgivning/exempel/status/
   demo-tamper/tenants/admin-* borttagna)
5. `WP15:` gräns-smoke (tests/ytor-smoke.test.ts med en andra byrå) + e2e
   omskriven med login-flöde → **PR #2 öppnad här**
6. `docs:` DEMO.md = Mats-demon (exakta klick + curl med verifierade
   statuskoder 422/403/401), README med fyra ytor + arkitekturbild i text,
   ADR-0003 → accepted
7. `polering:` 401 mitt i flöde → /login?next=…, mobiloverflow på
   verifikationskort, vänligare tomma tillstånd, e2e-smoke för
   utloggad-mitt-i-attest

## Designbeslut som gäller (bekräftade i kod)

1. **Kärnan fryst** — src/lib + src/contracts orörda hela passet (enda
   undantag, avstämt: additiv DDL i src/lib/db/schema.sql för leads +
   policy_mallar). All ytlogik bor i **src/ytor/** (leads/byra/operator).
2. **Attest bor hos byrån, drift hos operatören.** Operatörens vyer är
   aggregat — bolagsoversikt() läser aldrig proposals.payload; smoke-testat
   både i enhetstest och e2e ("Kaffebönor" får inte förekomma i svaret).
3. **Attest-språk** i /byra ("att attestera", "attesterad", "policybeslut"),
   aldrig "proposals". Policy-trösklarna formuleras "bokför själv upp till
   X kr för kända motparter" och mappar rakt på kärnans fält; bocken styr
   journal_entry/advisory_answer i tillatna_kinds. Correction auto-godkänns
   aldrig (hård regel i motorn, orörd).
4. **CSS-scoping per yta**: publik.css/.publik, byra.css/.byra,
   operator.css/.operator; globals.css fryst. Gesso/studio bär allt.
5. **decided_by = user-id ur sessionen** överallt; beslutsloggen slår upp
   namnet, policy-beslut märks separat. provisioned_by = operator:<user-id>.
6. **Upphovsman är Leopold Seifert** — inga påhittade namn/uppgifter;
   exempeldata i Exempel-stilen.

## Kända noteringar (inga blockerare)

- Byggvarningen "Encountered unexpected file in NFT list" är befintlig sedan
  S1 (skills.ts läser rules.json från disk) — bygget är grönt, inget nytt.
- scripts/e2e.py förutsätter FÄRSK dev-databas (`rm -rf .data`), står i
  skriptets docstring och i DEMO.md:s pre-flight. Andra körningen mot samma
  databas blir röd med flit (policyn är då öppnad → auto-bokföring).
- Dev-servern måste startas om efter schemaändringar (PGlite migrerar vid
  uppstart, singleton-cache).
- ADR-0003 bär "Deciders: Leopold, Love" ur originalfilen — orörd.

## Nästa steg (utanför S2 — starta ny session mot masterplanen)

- **Granska + merga PR #2** (CI kör test + build på PR:en).
- **S3 — intag + kundkanal**: /api/intake, mejladress per klient, kundappen
  (PWA). TODO-markörer finns där intaget kopplas in
  (src/app/api/byra/intag/tolka/route.ts).
- **S4 — deploy**: Supabase Auth bakom befintliga AuthAdapter-interfacet,
  pgmq bakom Ko-interfacet, Vercel.
- **S5 — mallar + Stripe**: policy_mallar är byggda som grunden;
  provisionAgent är Stripe-förberedd (provisioned_by bär källan).
