# ATTRIBUTION — vad vi lånar, varifrån, och vad som är vårt

Det här repot är byggt öppet. Innan en enda rad skrevs läste vi fem open source-projekt på
djupet, kontrollerade deras licenser mot respektive LICENSE-fil och dokumenterade exakt vad som
lånas — och på vilken nivå. Det är en styrka, inte en svaghet: **det som redan finns fritt ska
ingen bygga om.** Värdet ligger någon annanstans (se [Vår moat](#vår-moat) längst ned).

Detta dokument är fördjupningen av sammanfattningstabellen i [ULTRAPLAN.md §10](./ULTRAPLAN.md).
Alla licensuppgifter är kontrollerade mot källrepornas LICENSE-filer 2026-07-08.

## Principen

Vi skiljer på tre nivåer av lån, med olika krav:

1. **Referens** — vi läser, citerar och pekar. Kräver ingenting utöver hederlig källhänvisning.
2. **Mönster** — arkitekturidéer, formatspecifikationer, sektionsstrukturer. Idéer och format
   är inte upphovsrättsskyddade och får återimplementeras fritt med eget innehåll — men vi
   dokumenterar ändå varifrån de kommer, för det är så man bygger förtroende.
3. **Kod** — kräver en licens som är kompatibel med detta repos MIT-licens, och att
   copyright-notis och licenstext bevaras vid kopiering av substantiella delar.

**Ingenting lånas utan licenskontroll.** Två av de fem källorna nedan har licenser som inte
tillåter kodlån till ett MIT-repo (AGPL-3.0 respektive Dify Open Source License) — från dem tar
vi enbart mönster och format, aldrig text eller kod. Där vi hittat svagheter i förlagorna
dokumenterar vi dem öppet och rättar dem, i stället för att kopiera dem vidare.

## Snabböverblick

| Källa | Licens | Nivå |
|---|---|---|
| [Alexi5000/ClawKeeper](https://github.com/Alexi5000/ClawKeeper) | MIT ✅ | Mönster + utvalda kodmönster med attribution — **tre säkerhetssvagheter rättade** |
| [openaccountants/openaccountants](https://github.com/openaccountants/openaccountants) | AGPL-3.0-or-later + tilläggsvillkor ⚠️ | **Endast format och modeller** — ingen text, ingen kod |
| [vas3k/TaxHacker](https://github.com/vas3k/TaxHacker) | MIT ✅ | Mönster (ev. kodfragment med attribution) — kända svagheter åtgärdade |
| [e2b-dev/E2B](https://github.com/e2b-dev/E2B) + [e2b-dev/infra](https://github.com/e2b-dev/infra) | Apache-2.0 ✅ | Enbart referens i arkitekturplanen — ingen kod |
| [langgenius/dify](https://github.com/langgenius/dify) | Dify Open Source License ⚠️ | **Enbart mönster, ingen kod** (licensen tillåter det inte) |

---

## Alexi5000/ClawKeeper

**Licens:** MIT (»Copyright (c) 2026 ClawKeeper Contributors«) — fullt kompatibel med detta
repo. Vid kopiering av substantiella koddelar bevaras copyright-raden och licenstexten.

ClawKeeper är en »auditable SMB finance-agent control plane« och den källa som ligger närmast
grundboks kärna: deterministisk policy utanför LLM:en, tenant-isolering i två lager, append-only
audit. Det är också den källa vi läst mest kritiskt — vi hittade tre säkerhetssvagheter som vi
rättar i stället för att ärva.

### Vad vi lånar

| Mönster | Varifrån i deras repo |
|---|---|
| **Policy-motor som ren funktion** — `evaluate(input) → beslut`, DB-fri och testbar utan infrastruktur; körs före varje exekvering (tenant-match → behörighet → beloppströskel → injection-signaler → allow/deny/requires_approval); audit-händelsen är en biprodukt av beslutet | `src/openclaw/policy.ts`, tester i `test/openclaw.policy.test.ts` |
| **Policyregler som data, inte kod** — deklarativ capability-tabell (`requires_approval`, `max_autonomous_amount`, `allowed_roles` per capability) | `src/openclaw/manifest.ts` |
| **Gate i basklassen** (template method) — policykontrollen ligger i den enda exekveringsvägen, så en agent *kan inte* glömma den; beslutet auditloggas även vid deny | `src/agents/base.ts` (`execute_task`), `src/openclaw/runtime.ts` |
| **RLS-SQL-struktur** — helper-funktion som läser tenant ur GUC, per-tabell-policyer, rollskiktade SELECT/INSERT/DELETE-regler med `WITH CHECK` | `db/rls.sql`, `docs/MULTI-TENANCY.md` |
| **Append-only via triggers** — `BEFORE UPDATE OR DELETE`-trigger som kastar exception; generisk audit-trigger på finansiella tabeller | `db/schema.sql`, `db/rls.sql` |
| **Rekursiv PII-/secret-redaktion före audit-skrivning** — liten ren funktion; vi byter deras regexar mot svenska mönster (personnummer, bankgiro/OCR) | `src/openclaw/policy.ts` (`redact_policy_payload`), `src/guardrails/validators.ts` |

### Tre svagheter vi rättar (viktigast i hela dokumentet)

Dessa hittades vid kodläsning och dokumenteras här öppet — den som lånar samma mönster bör inte
kopiera felen:

1. **Session-`SET` av tenant-GUC på en delad pool.** Deras middleware kör
   `sql.unsafe("SET app.current_tenant_id = '…'")` — session-nivå med stränginterpolering — på
   en delad connection-pool (`src/api/server.ts`). GUC:en kan hamna på fel poolad anslutning
   under samtidiga requests och ligga kvar mellan requests; dessutom fortsätter servern vid
   GUC-fel. **Vår rättelse:** tenant-kontexten sätts *transaktionsscopat* med parametriserad
   `set_config('app.tenant_id', $1, true)` — den kan aldrig läcka mellan requests, och ett fel
   avbryter transaktionen.
2. **`ENABLE` utan `FORCE ROW LEVEL SECURITY`, plus serviceroll med `BYPASSRLS`.** Deras
   tabeller har bara `ENABLE ROW LEVEL SECURITY` (verkningslöst för tabellägaren) och
   servicerollen får `BYPASSRLS` + `GRANT ALL` — i praktiken kan RLS vara ren dekoration.
   **Vår rättelse:** `FORCE ROW LEVEL SECURITY` på alla kunddatatabeller, och appen kör som
   **icke-ägande roll utan `BYPASSRLS`**.
3. **Blind tillit till `approval_id`.** Vilken sträng som helst i `task.parameters.approval_id`
   släpper igenom en task som kräver godkännande — ingen verifiering av *vem* som godkände
   eller *vad* som godkändes (deras README medger: »Approval metadata is trusted once
   provided«). **Vår rättelse:** godkännandet binder konsultens identitet till en **hash av
   exakt det förslag som godkändes** — ändras en konteringsrad efter godkännande är
   godkännandet ogiltigt. Se ULTRAPLAN.md §3.

### Vad vi inte tar

Ärlig varudeklaration: stora delar av ClawKeeper-repot är fasad. Alla 100 »workers« delar en
stub som returnerar inspelad framgång, AGENT.md-filerna är identisk boilerplate, och
skills-filerna **laddas aldrig av koden** (noll referenser i `src/`) — de saknar dessutom
versionsfält. Vi lånar de delar som är på riktigt (policy-motorn, RLS-SQL:en, audit-triggers,
basklass-enforcement) och lämnar:

- 110-agents-orkestreringsteatern och worker-stubbarna,
- de engelska/amerikanska injection- och PII-regexarna (SSN-format, »ignore previous
  instructions«) — vi skriver svenska mönster och förlitar oss primärt på strukturell
  separation av data och instruktioner,
- deras `audit_log` med lossy CHECK-constraint — vår ledger får ett riktigt händelseschema
  med tenant-scopade löpnummer (BFL:s verifikationsnummerkrav),
- skills-formatet som aldrig kopplades till koden — grundbok bygger loadern, semver-fältet
  och CI-körningen av exempel som testfall, dvs. exakt det ClawKeeper hoppade över.

---

## openaccountants/openaccountants

**Licens:** AGPL-3.0-or-later, med tilläggsvillkor enligt AGPL §7 (`LICENSE-ADDITIONAL.md`:
attribution, »Open Accountants«-namnet och länk till openaccountants.com måste bevaras även i
användarvänd output). Projektet är dual-licensierat — kommersiell licens säljs av ägarbolaget
(`COMMERCIAL_LICENSE.md`).

**AGPL är oförenlig med detta MIT-repo.** AGPL:s nätverks-copyleft innebär dessutom att den som
serverar deras skill-text genom en SaaS-tjänst måste AGPL:a den delen. Därför gäller en hård
regel: **ingen fil, ingen text, ingen kod kopieras härifrån.** Formatet och modellerna —
strukturidéer, inte innehåll — är däremot fria att återimplementera, och det är precis vad vi
gör: allt innehåll i `skills/` i detta repo är skrivet från primärkällor (riksdagen.se,
Skatteverket, BFN, bas.se).

### Vad vi lånar (endast format och modeller)

| Modell | Varifrån i deras repo |
|---|---|
| **Frontmatter-specen** — YAML-nycklar som `name`, `description` med trigger-fraser, `jurisdiction`, `tier`, `verified_by`, `version`, `last_updated`, `depends_on`; CI-tvingad struktur | `docs/skill-template.md`, `scripts/validate-guides.py` |
| **Tier 1/2-verifieringsmodellen** — tier 2 = källciterat AI-utkast (`verified_by: pending`), tier 1 = granskat av namngiven licensierad praktiker; promotion-flöde med granskningsarbetsbok | `docs/QUALITY-TIERS.md`, `scripts/build-verification-workbook.py` |
| **Reviewer brief-kontraktet** — varje körning måste producera en strukturerad brief: bottom line, flaggor att granska först, applicerade konservativa defaults med motivering, vilka underlag granskaren bör begära in. »The reviewer is the customer.« Förebild för konsultagentens vy (ULTRAPLAN.md §5) | `skills/foundation/vat-workflow-base.md` (Section 3) |
| **Refusal-katalogidén** — numrerade deterministiska hårdstopp per land (momsgrupper, vinstmarginalbeskattning, proportionell avdragsrätt …) där systemet ska vägra och eskalera till människa i stället för att gissa. Vi implementerar idén som regler i vår policy-motor, med eget innehåll | `skills/international/sweden/sweden-vat-return.md` (Section 2) |
| **Country slot-mönstret** — domänagnostisk workflow-bas + regionalt lager + tunt landsskill som fyller definierade »slots« (defaults, trösklar, refusals); orkestrering som tunn fil, inte kodprojekt | `skills/foundation/vat-workflow-base.md` (Section 7), `skills/orchestrator/global-router.md` |

Våra skills byggs **format-kompatibla** med deras frontmatter-spec, så att innehåll *kan*
bidras uppströms om det beslutas — men kompatibilitet är inte kopiering.

### Sverige-läget hos dem — och möjligheten

openaccountants har redan en Sverige-katalog (9 filer, ~3 600 rader: moms med
deklarationsrutor, BAS-strukturen, arbetsgivaravgifter). Men **allt är tier 2** — AI-utkast med
`verified_by: pending` — och det innehåller faktiska fel: t.ex. anges gränsen för
förbrukningsinventarier till ett belopp motsvarande ett inaktuellt halvt prisbasbelopp. Deras
egen README ber uttryckligen om en auktoriserad granskare, och deras partner-lista
(`docs/VERIFIERS.md`) saknar Sverige helt. **Möjligheten:** byråernas auktoriserade konsulter
kan bli de namngivna svenska tier 1-granskarna — trovärdighet och synlighet som ingen
konkurrent har.

### CLA-frågan — öppet strategiskt val

Uppströms-bidrag kräver deras CLA: bidragsgivaren behåller copyright men ger ägarbolaget
**dual-licens-rätt** — dvs. rätten att sälja det bidragna svenska innehållet kommersiellt, även
till konkurrenter. Det är ett medvetet strategiskt beslut som inte behöver fattas nu. Repot
byggs format-kompatibelt så att dörren står öppen åt båda hållen.

### Vad vi inte tar

- **Ingen text eller kod** — AGPL smittar och kan inte relicensieras till MIT.
- Deras »determinism« exekveras av LLM:en via prompt (lookup-tabeller i markdown). Vi lägger
  determinismen i en kodmotor utanför LLM:en (`rules.json` + policy-motor) — deras arkitektur
  är inspirationsdata, inte en färdig motor.
- Multi-tenant-drift, ledger och approval-gates finns inte alls hos dem — det kommer från vår
  egen stack.

---

## vas3k/TaxHacker

**Licens:** MIT (Copyright (c) 2025 Vasily Zubarev) — fullt kompatibel. Copyright-notisen
bevaras vid kopiering av substantiella delar.

TaxHacker är en självhostad »personlig AI-revisor«: kvitton och fakturor in, vision-LLM
extraherar strukturerad data, människan granskar och sparar. Kärnmönstret — LLM föreslår,
människa godkänner, först då persist — är vårt extraktionsflöde i miniatyr.

### Vad vi lånar

| Mönster | Varifrån i deras repo |
|---|---|
| **Fil→bild-normalisering före LLM** — PDF:er blir webp-bilder per sida (pdf2pic/sharp), bilder skalas, allt skickas base64 till en vision-modell; OCR och tolkning i ett steg | `ai/attachments.ts`, `lib/previews/pdf.ts`, `lib/previews/generate.ts` |
| **Schema-som-data** — extraktionsfälten är databasrader (med egen `llm_prompt` per fält), inte hårdkodade; schemat genereras dynamiskt till structured output. Mappar 1:1 på våra branschmallar: café/bygg/konsultbyrå = olika fältuppsättningar som config | `ai/schema.ts`, `prisma/schema.prisma` (model `Field`), `models/defaults-data.ts` |
| **Promptmall med config-injektion** — platshållare (`{fields}`, `{categories}`) ersätts med rader genererade ur kundens config | `ai/prompt.ts` |
| **Cachat parse-resultat + mänsklig granskning före persist** — LLM-svaret skrivs till `cachedParseResult` (idempotent), prefillar ett granskningsformulär, och först när människan sparar valideras och persisteras det. Approval-gate-principen i miniatyr | `ai/analyze.ts`, `app/(app)/unsorted/actions.ts`, `components/unsorted/analyze-form.tsx` |
| **Radpost-splittring** — ett kvitto med flera poster kan delas till separata transaktioner som var och en går genom granskningsflödet; relevant när samma kvitto bär olika BAS-konton/momssatser | `app/(app)/unsorted/actions.ts` (`splitFileIntoItemsAction`) |

### Svagheter vi åtgärdar

Dokumenterade vid kodläsning; alla fyra är åtgärdade i grundboks flöde:

1. **Enum-via-prompt.** Deras kategoriklassning ber LLM:en välja »en av: …« i prompttext —
   hallucinerade koder är möjliga och inget validerar utdata. **Vi:** tillåtna BAS-konton
   ligger som riktig `enum` i schemat, *och* policy-motorn validerar deterministiskt efteråt.
2. **Ingen utdatavalidering eller retry.** LLM-svaret valideras aldrig mot schemat; enda
   återhämtningen är failover till nästa provider. **Vi:** zod-validering av varje LLM-svar
   med retry vid schemafel.
3. **Ingen aritmetikkontroll.** Inget kontrollerar att beloppen går ihop. **Vi:** motorn
   verifierar netto + moms = brutto och att momssatsen stämmer med regelverket, före förslag.
4. **`parseFloat` på beloppssträngar.** Rätt idé (belopp som heltal i minsta enhet), skör
   implementation — svenska kvitton använder decimalkomma. **Vi:** locale-medveten
   decimalparsning och **ören som heltal** hela vägen.

### Vad vi inte tar

- Tenant-isolering på app-nivå (`userId` i varje query) — vår isolering ligger i Postgres RLS.
- Kontoval i LLM:en — hos oss väljer regelmotorn konton, inte modellen.
- Filhantering på lokal disk per användare — singelanvändarcentrerat, passar inte per-kund-miljöer.

---

## e2b-dev/E2B + e2b-dev/infra

**Licens:** Apache-2.0 — verifierat för **båda** repona (SDK/CLI respektive
exekveringsinfrastruktur). Kompatibel med MIT; vid faktisk kodkopiering krävs bevarad
copyright-/licensnotis, men ren referens kräver ingenting.

**Nivå: enbart referens i arkitekturplanen. Ingen kod i detta repo.**

E2B refereras i ULTRAPLAN.md §2 som förlaga för exekveringslagret:

- **MicroVM per kund** — varje sandbox är en Firecracker-microVM med egen gästkärna; två
  kunder delar inga kernel-kodvägar. Det är isoleringsgränsen grundbok formulerar: VM-gräns
  per *kund*, inte processgräns per *agent* ([docs](https://e2b.dev/docs/sandbox),
  [infra-repot](https://github.com/e2b-dev/infra)).
- **Snapshot-paus/resume** — pausade miljöer sparar både filsystem och minnestillstånd och
  kostar noll compute; återupptas på ~1 sekund. Den tekniska definitionen av vårt
  »per-kund-miljö med scale-to-zero« ([docs](https://e2b.dev/docs/sandbox/persistence)).
- **Template = config** — miljömallar definieras programmatiskt och instansieras per kund;
  rimmar exakt med branschmall = template, kundinstans = config
  ([docs](https://e2b.dev/docs/sandbox-template)).

Noterade förbehåll innan referensen blir ett val: EU-region/DPA eller self-host krävs för
svensk bokföringsdata (GDPR); prestandasiffrorna är leverantörens egna; och den append-only
verifikationsledgern ligger alltid i vår egen Postgres — aldrig enbart i en sandbox-snapshot.

---

## langgenius/dify

**Licens:** Dify Open Source License — Apache-2.0-bas med tilläggsvillkor, bland annat **förbud
mot multi-tenant-drift utan kommersiell licens** samt logo-/copyright-skydd. Ingen officiell
SPDX-identifierare. Tilläggsvillkoren gör att kod **inte** kan tas in i detta MIT-repo.

**Nivå: enbart mönster, ingen kod.** Mönstren är dokumenterade härifrån för att config-lagret i
ULTRAPLAN.md §4 ska gå att spåra till sin förlaga:

| Mönster | Varifrån i deras repo |
|---|---|
| **Config-DSL-kuvertet** — en app är inte kod utan en versionerad, exporterbar config-fil (`version` / `kind` / innehåll / `dependencies`); vi lånar kuvertet, inte deras grafformat | `api/services/app_dsl_service.py` |
| **Semver-gate vid mallimport** — versionsjämförelse vid import mappas till utfall: ogiltig → FAILED, nyare/lägre MAJOR → PENDING (kräver bekräftelse), lägre MINOR → varning, annars OK. Hos oss: MAJOR-uppgradering av branschmall kräver konsultgodkännande, MINOR varnar | `api/services/dsl_version.py` (`check_version_compatibility`), `api/constants/dsl_version.py` |
| **Tenant-neutral mall + tenant-bunden instans** — mallfilen innehåller aldrig tenant-referenser; bindningen sker i importögonblicket. Branschmallen i git förblir kundneutral; kundinstansen är diffen mot mallen | `api/services/app_dsl_service.py` (import-flödet) |
| **Secrets utanför config** — export strippar credentials som standard; nyckelmaterial refereras med namn och lever i secret store, aldrig i config-filen | `api/services/app_dsl_service.py` (`include_secret`, `credential_id`-strippning) |

### Anti-mönster vi uttryckligen undviker

Dify är också ett varnande exempel, och det hör hemma i en ärlig attribution:

- **Isolering enbart på app-nivå.** Difys tenant-isolering är ett `tenant_id`-filter i varje
  ORM-query — ingen RLS, inget databaslager. Ett enda glömt WHERE-villkor läcker data mellan
  tenants. Grundbok lägger enforcement i databasen (RLS med `FORCE`, se ClawKeeper-avsnittet)
  plus per-kund-miljö som andra lager.
- **Tabeller utan egen `tenant_id`.** Vissa av deras tabeller isoleras indirekt via joins —
  svårt att auditera. Grundboks regel: `tenant_id` på **varje** kunddatabärande tabell, utan
  undantag (ULTRAPLAN.md §7).

---

## Vår moat

Efter all attribution återstår frågan: vad är då *vårt*? Svaret är uttalat, och det är
medvetet ingenting av ovanstående:

1. **Den svenska domänen som versionerade, maskinexekverbara skills.** BAS-kontering, svensk
   moms med gällande datumavgränsade satser, bokföringslagens verifikationskrav, Skatteverkets
   praxis — som diffbara filer där läsbar regel (`SKILL.md`), exekverbar data (`rules.json`)
   och testfall hänger ihop, och där varje bokförd verifikation kan svara på »vilken
   regelversion, vilken modell, vilket underlag«. Ingen av de fem källorna har detta:
   ClawKeeper har skills som aldrig laddas, openaccountants har regler som bara LLM:en
   exekverar. Syntesen är vår.
2. **Verifieringen av riktiga konsulter.** Innehåll märks ärligt som utkast tills en
   auktoriserad konsult granskat det — och byråernas konsulter är exakt de granskare som ingen
   annan har knutit till sig. Domänkunskap som *någon står för* är inte commodity.
3. **Branschmallarna.** Café, bygg (omvänd betalningsskyldighet), konsultbyrå — färdiga,
   verifierade startpunkter som kodifierar svensk branschpraxis, t.ex. hur en
   leverantörsfaktura till »Kafferosteriet Exempel AB« ska konteras med rätt momssats för
   rätt datum.
4. **Den tvåsidiga modellen anpassad till konsult-affären.** Klientagent som aldrig får
   godkänna, konsultagent med granskningskö — samma skills-bibliotek, två manifest. Modellen
   respekterar att ansvaret enligt lag ligger hos företagsledningen och att konsulten äger
   kundrelationen.
5. **Distributionen genom byråerna.** Kanalen är inte teknik och kan inte lånas från GitHub.

Allt annat — policy-motor-mönster, RLS-struktur, extraktionsflöden, microVM-isolering,
config-kuvert — är commodity och lånas öppet, med licenskontroll och attribution. Det är hela
poängen med det här dokumentet.
