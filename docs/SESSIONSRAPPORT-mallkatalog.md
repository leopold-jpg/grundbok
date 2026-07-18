# Sessionsrapport — mallkatalog-passet (WP11–WP13 + ADR-0005-omgörningen)

**Datum**: 2026-07-18 · **Branch**: `mallkatalog` · **PR**: [#6](https://github.com/leopold-jpg/grundbok/pull/6) (öppen, **ej mergad**) · **Tester**: 159 gröna

## Vad som gjordes i sessionen

### 1. Utgångsläge
Branchen innehöll färdiga WP11–WP13 (mallregister som kod, telemetrimigration
+ `agent_telemetry`-vyn, flottöversikt i operatörskonsolen) med 154 gröna
tester — men byggda med **bransch-id:n** (bokforing-bygg/-restaurang/-konsult,
lon) enligt ADR-0004:s ursprungliga mallista.

### 2. Riktningsändring: ADR-0005 genomförd
`0005-funktionsmallar-med-branschpaket.md` flyttad till `docs/adr/`, index
uppdaterat, not i ADR-0004 att release-ett-mallistan ersätts (kärnbesluten
kvarstår). Registret omgjort:

- **Funktionsroller**: `bokforing`, `lon`, `skatt-compliance`,
  `leverantorsreskontra`. `MallId` förblir egen typ; `skatt-compliance` →
  modulen `skatt-juridik`, `leverantorsreskontra` → `bokforing`.
- **Branschpaket**: `branschpaketRegistret` med `bygg` (omvänd byggmoms +
  ROT — flyttade ur bygg-stubben) och `restaurang` (livsmedelsmoms +
  kassarapport). `MallDefinition.branschpaket?: BranschPaketId[]` deklarerar
  vad rollen kan aktivera; aktivering härleds ur tenant-kontexten
  (`tenants.mall`: bygg→bygg, cafe→restaurang, konsultbyra→inga) via
  `paketForTenantMall`/`aktivaBranschpaket`/`effektivaRegler`.
- **Regel-hemvist** per tumregeln: representation + periodisering gäller
  fler branscher → funktionsmallen; test låser att ingen regel bor i både
  mall och paket, och att varje branschmall i `customers/mallar/` har ett
  explicit paketbeslut.
- **Förvalspolicyer** (designbeslut i passet): `bokforing` ärver rutinnivån
  (2 000 kr/0.85/kända motparter), `leverantorsreskontra` den försiktigare
  (1 000 kr/0.9), `lon` + `skatt-compliance` auto-godkänner aldrig.
- **Flottöversikten** visar aktiva paket per agent (`+bygg` i malletiketten,
  härlett — lagras aldrig på agentraden); provisioneringsvalet visar
  rollernas paket; `/api/operator/agentmallar` exponerar paket-id:n som
  metadata (aldrig regler/systemPrompt).
- Golden-testerna omskrivna: per roll och per **verklig** mall×paket-
  kombination; historiska förslag stämplade med gamla bransch-id:n
  validerar fortsatt (nytt test).

### 3. Rebase mot main (PR #5 var mergad)
PR #5 (design-audit, D2-skinnet på /byra + /operator) mergades 14:38 —
branchen rebasad på main. Konflikter lösta i `operator.css` (två additiva
block, båda behållna) och `page.tsx` (importrad; granskningsfixens
borttagning av registry-importen bevarad). Verifierat: inga markörer,
CSS-klammerbalans, tsc + 158 tester + produktionsbygge gröna direkt efter.

### 4. Kvalitetsgrind: adversariell granskning, pass 2
Två oberoende granskare (korrekthet resp. läckage/policy/RLS/auth) på den
omgjorda diffen. **Inga höga fynd.** Åtgärdat (`16daf9d`):

| Fynd | Åtgärd |
|---|---|
| Policyseedningens SELECT-före-insert kunde racea vid samtidig provisionering | Atomär `INSERT … ON CONFLICT DO NOTHING` |
| `mall_version`-regexen tillät godtyckligt långa sifferföljder in i payload/operatörsvy | `max(32)` i kontraktet |
| Ny branschmall i `customers/mallar/` kunde tyst aktivera inga paket | Test kräver explicit paketbeslut per branschmall |
| Flottan-sektionen avvek från mains D2-konventioner (span-rubrik, inline overflow-style) | `h2` + `.svep` |
| Odokumenterade invarianter (mall_version-undantaget i operatörsfilen; reskontrans onåbara förval; paketens runtime-inerthet) | Dokumenterade i kod + testkommentar |

**Avfärdat med motivering**: rått `err.message` i 422 från `/api/agents`
(pre-existerande mönster, autentiserad operatörspublik) · reskontrans
förvalspolicy "onåbar" vid befintlig bokforing-policyrad (deterministiskt,
test-låst; verklig fix = policy per **mall** i stället för per modul — ett
schemabeslut som inte ska smygas in i detta pass, dokumenterat som känd
begränsning i registret).

**Verifierat rent**: bundle-regeln (0 träffar på registerinnehåll i
`.next/static` efter bygge; registret importeras endast serversidigt) ·
operatörsregeln (aggregat, aldrig summary/belopp/motpart) · RLS
(`security_invoker`-vyn tenant-scopad; tenants-joinen endast i
operatörsgatad service-väg) · auth (alla nya routes bakom `kravOperator`).

### 5. Hygienkontroll (inget ändrat — enbart noterat)

- **Worktree**: `~/grundbok-d2` står på `design-audit` som är mergad via
  PR #5 → kandidat för `git worktree remove ~/grundbok-d2`.
- **Mergade lokala brancher som kan raderas**: `design-audit`,
  `design-sajt`, `design-system`, `modul-plattform`, `ytor`. Lokala `main`
  är 56 commits efter origin (kan fast-forwardas). `deploy-forarbete` är
  **inte** mergad (1 commit: DEPLOY-STATUS-dokumentet) — behåll.
- **rescue/-taggar**: 5 st (`a11y-hero-curve`, `a11y-validation`,
  `reduced-motion-caret`, `reveal-nojs`, `usespelar-reduced-motion`) —
  ingen mergad i main; mänskligt beslut om radering.
- **Otrackade filer**: `KICKOFF-ARBETSYTOR.md`, `KICKOFF-INTAG.md`
  (kommande pass-dokument), `designurval.html` — inga gitignore-kandidater;
  committas när respektive pass startar.
- **`tsconfig.tsbuildinfo` är trackad** — byggartefakt som borde
  gitignoreras (blockerade t.o.m. dagens rebase tills den återställdes).
  Föreslagen åtgärd (ej utförd): `git rm --cached tsconfig.tsbuildinfo` +
  rad i `.gitignore`.
- **`.env.local` finns ALDRIG i git-historiken** (`git log --all --
  .env.local` tom; enda .env-filen i historik är `.env.example`,
  avsiktligt). `.env.local` på disk täcks av `.gitignore`:s `.env.*`.

## Commits på branchen (utöver main)

```
16daf9d granskningsfixar ADR-0005-passet: atomär seedning, semver-tak, paketfacit
c8c2bcf mallar: funktionsroller med branschpaket (ADR-0005)
c924764 docs: ADR-0005 funktionsmallar med branschpaket
ccdb2ec granskningsfixar: policyseedning, bundle-läcka, stale-races, 7d-låsning
(4bbf61d) docs: kickoff-dokumentet
(b3e770c) flotta: flottöversikt (WP13)   [rebasad hash]
(…)      telemetri (WP12), mallar (WP11), docs ADR-0004
```

## Återstår för människan

1. **Granska och merga PR #6** — särskilt designbesluten: förvalspolicy-
   nivåerna per roll, regel-hemvisterna (representation/periodisering i
   mallen), tenantmall→paket-mappningen (cafe→restaurang) och den kända
   policybegränsningen för `leverantorsreskontra`.
2. **Beslut: policy per mall eller per modul** — reskontrans rollskilda
   autonomi kräver att `autonomy_policies` nyckas på mall (eller agent),
   inte modul. Bör bli ett eget ADR innan reskontran får verklig trafik.
3. **Städning enligt hygienlistan ovan** (worktree, mergade brancher,
   rescue-taggar, `tsconfig.tsbuildinfo`).
4. **Nästa pass: arbetsytor** — `KICKOFF-ARBETSYTOR.md` ligger redo i
   repo-roten (otrackad). ADR-0005 förenklar trestegflödet: mallvalet blir
   fyra roller, branschen härleds ur tenanten. Därefter/parallellt:
   `KICKOFF-INTAG.md`. Kommande innehållspass fyller mallarnas prompter
   och väver branschpaketen in i LLM-vägen (+ `prompt_hash`) — paketen är
   runtime-inerta tills dess.
