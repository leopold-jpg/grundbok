# ULTRAPLAN — grundbok

**Vad detta är.** Ett arkitekturförslag — en add-on, inte en omskrivning — för hur en svensk
agentisk redovisningsplattform bör bygga sina kommande expertagenter. Dokumentet åtföljs av en
körbar vertikal skiva som demonstrerar arkitekturen ände till ände: kvitto in → tolkning →
BAS-kontering med moms → konsultgodkännande → bokfört i append-only-ledger.

**Byggt öppet.** Vi har läst fem open source-projekt på djupet, kontrollerat deras licenser och
dokumenterar exakt vad som lånas varifrån i [ATTRIBUTION.md](./ATTRIBUTION.md). Det är en styrka,
inte en svaghet: det som redan finns fritt ska ingen bygga om — värdet ligger i den svenska
domänen, verifierad av riktiga konsulter, och i distributionen genom byråerna. Alla lagcitat i
detta dokument är verifierade mot primärkällor (riksdagen.se, Skatteverket, BFN, bas.se) 2026-07-08.

---

## 1. Tesen: ett skills-bibliotek, inte fyra expertagenter

Efterfrågan från större byråer pekar mot fyra experter: **löner, skatt, bokslut,
bokföringsfrågor**. Den intuitiva vägen är att bygga fyra agenter. Det är fel väg, av tre skäl:

1. **Domänkunskapen överlappar massivt.** Alla fyra behöver momsreglerna, BAS-kontoplanen,
   verifikationskraven, periodiseringslogiken. Fyra agenter = samma kunskap duplicerad i fyra
   promptar som glider isär vid varje regeländring — och reglerna ändras på riktigt: livsmedel
   bytte momssats så sent som 1 april i år (se §6).
2. **Kunskap i promptsträngar går inte att granska.** En byrå måste kunna svara på frågan
   *"vilken regelversion fattade systemet det här beslutet med?"* Det kräver att domänkunskapen
   är versionshanterad, diffbar och testbar — som filer, inte som inbakade promptar.
3. **Fyra kodbaser är fyra gånger underhållet** — och konsolideringen efteråt är ett projekt
   ingen vill betala för. Experterna är inte byggda än; det är billigare att bygga den
   gemensamma kärnan först än att slå ihop fyra färdiga agenter om ett år.

**I stället:** ett gemensamt, versionshanterat **skills-bibliotek**. En "expert" är ett tunt
orkestreringslager — en manifest-fil som pekar ut vilka skills den laddar, vilka verktyg den får
använda och vilka policy-gates som gäller. En femte expert är en ny manifest-fil, inte ett nytt
kodprojekt.

```
skills/                          agents/
  se/                              bokforing.agent.json   ← manifest: skills + verktyg + policy
    moms/                          skatt.agent.json
      SKILL.md                     loner.agent.json         (framtida)
      rules.json                   bokslut.agent.json       (framtida)
      config.schema.json
    bas-kontering/  (samma trio)
    periodisering/  (samma trio)
```

**Varje skill är tre filer** — och det är poängen med hela biblioteket:

- `SKILL.md` — regler i läsbar form med lagrumshänvisningar, triggers, exempel,
  verifieringsstatus. Format-kompatibel med openaccountants (YAML-frontmatter: `name`,
  `description` med trigger-fraser, `jurisdiction: SE`, `tier`, `verified_by`, `version`,
  `last_updated`, `depends_on`) så att innehållet kan bidras uppströms.
- `rules.json` — samma regler som **maskinläsbar data** (satser med giltighetsdatum,
  kontomappningar, trösklar) som den deterministiska motorn exekverar. Detta är vår syntes av
  två halvfärdiga idéer: ClawKeeper har skills-filer som *aldrig laddas av koden*, och
  openaccountants har utmärkta regeltabeller som *bara LLM:en exekverar via prompt*. grundbok
  gör skillen till källa för båda: LLM:en läser SKILL.md, policy-motorn exekverar rules.json,
  och exemplen i SKILL.md körs som testfall mot motorn i CI.
- `config.schema.json` — vilka kundspecifika parametrar skillen accepterar.

**Uppströms-läget är bättre än väntat — och det är en pitch-poäng.** openaccountants har redan
en Sverige-katalog (9 filer, ~3 600 rader: moms med deklarationsrutor, hela BAS-strukturen,
arbetsgivaravgifter). Men *allt* är tier 2 — AI-utkast med `verified_by: pending` — och det
innehåller faktiska fel (t.ex. inaktuell gräns för förbrukningsinventarier). Deras
partner-lista saknar Sverige helt. Byråernas auktoriserade konsulter kan bli de namngivna
svenska granskarna (tier 1-promotion) — trovärdighet och synlighet som ingen konkurrent har.
*(Beslut krävs före uppströms-PR: deras CLA ger ägarbolaget rätt att sälja bidraget innehåll
kommersiellt — se §12.)*

---

## 2. Isolering vid kunden, inte vid agenten

Det vanliga mönstret — en persistent Linux-miljö per **agent** — är fel isoleringsgräns åt båda
hållen:

- **För svag där det räknas:** risken som ska hanteras är att kund A:s data når kund B — inte
  att skatteexperten ser löneexpertens minne. Agentgränsen skyddar inte mot tenant-läckage alls.
- **För stark där den skadar:** experterna för *samma* kund ska **dela kontext**. Lönerna
  påverkar bokslutet; momsfrågan påverkar konteringen. Fyra silos per kund tvingar fram
  copy-paste mellan agenter.
- **Fel kostnadsmodell:** persistenta burkar × agenter × kunder växer multiplikativt och står
  mest och idlar.

**Mönstret i stället — per-kund-miljö med scale-to-zero:**

```
                 ┌─ Kundmiljö: Kund A (café) ──────────────┐
   väcks på ──►  │  bokförings-  skatt-   (löner)  (bokslut)│  ◄─ delar kontext,
   anrop,        │  agent        agent                      │     samma tenant-scope
   snapshot-     │  ─────────── gemensam kundkontext ────── │
   pausas vid    └───────────────────┬─────────────────────┘
   inaktivitet                       │ tenant_id = kund_a, transaktionsscopat
                 ┌───────────────────▼─────────────────────┐
                 │  Postgres med Row Level Security         │  ◄─ andra försvarslinjen:
                 │  policy: rad synlig ⇔ rätt tenant_id     │     även buggig kod kan inte
                 └─────────────────────────────────────────┘     läsa fel kunds rader
```

**Försvarslinje 1 — runtime-isolering per kund.** Referensmönstret är E2B/Fly Machines: en
Firecracker-klass microVM per kund (egen kärna — två kunder delar inga kernel-kodvägar),
snapshot-pausad till noll compute mellan sessioner, återupptagen på ~1 sekund med bevarat
tillstånd. E2B:s templates är dessutom config-definierade — vilket rimmar exakt med §4:
branschmall = template, kundinstans = config. Ingen integration ikväll; arkitekturen ska bara
aldrig anta en persistent burk. *(GDPR-not: E2B:s moln kräver EU-region/DPA eller self-host
innan det lyfts från referens till val.)*

**Försvarslinje 2 — RLS i Postgres.** Varje tabell med kunddata har en policy som binder
radåtkomst till `tenant_id`. Strukturen lånas från ClawKeeper (MIT), men vi rättar tre kända
svagheter i deras applicering, dokumenterat i ATTRIBUTION.md:

1. Tenant-kontexten sätts **transaktionsscopat** med parametriserad
   `set_config('app.tenant_id', $1, true)` — inte session-`SET` på en delad pool, där GUC:en
   kan fastna på fel anslutning mellan samtidiga requests.
2. `FORCE ROW LEVEL SECURITY` — inte bara `ENABLE`, som är verkningslöst för tabellägaren.
3. Appen kör som **icke-ägande roll utan `BYPASSRLS`** — annars är policyerna dekoration.

Detta är **demonstrerat live i skivan** (verifierat körbart redan nu, se §7): byt tenant i UI:t
och kund A:s rader är borta — på databasnivå, inte via if-satser.

GDPR faller ut naturligt: kunddata är per definition tenant-scopad; lagringsminimering hanteras
i policy-lagret med respekt för att räkenskapsinformation *måste* bevaras (§6).

---

## 3. Policy-motorn: deterministisk kod utanför LLM:en

Allt en agent producerar är **förslag**. Beslutet — att bokföra, att betala — fattas av en
människa, och grinden är **kod, inte prompt**:

```
dokument ──► injection-check ──► LLM-tolkning ──► regelmotor (rules.json) ──► FÖRSLAG
                (kod)              (schema-låst)     (kod: moms, konton,          │
                                                      debet=kredit, refusals)     │
                                            konsult godkänner ◄──────────────────┘
                                                   │ (enda vägen till bokföring)
                                            append-only ledger
```

Mönstret lånas från ClawKeeper, vars policy-motor är exakt rätt idé: en **ren, DB-fri
TypeScript-funktion** `evaluate(input) → beslut` som körs före varje exekvering (tenant-match →
behörighet → beloppströskel → injection-signaler → allow/deny/requires_approval), med
**policyregler som data** (`{ capability: "registrera_verifikation", requires_approval: true,
max_autonomous_amount: 0, allowed_roles: ["konsult"] }`) och audit-händelsen som biprodukt av
beslutet. Gaten sitter i basklassen — den enda exekveringsvägen — så en expert *kan inte*
glömma den.

Vi förbättrar tre saker mot förlagan (alla dokumenterade i ATTRIBUTION.md):

- **Godkännandet binds kryptografiskt till innehållet.** ClawKeeper litar blint på att ett
  `approval_id` finns. Hos oss binder godkännandet konsultens identitet till en **hash av
  exakt det förslag som godkändes** — ändras en konteringsrad efter godkännande är
  godkännandet ogiltigt. (Detta är BFL 5 kap. 7 §-tänket applicerat på beslutskedjan.)
- **Svenska injection- och PII-mönster.** Deras regexar är engelska/amerikanska (SSN, "ignore
  previous instructions"). Vi skriver svenska mönster (personnummer, bankgiro/OCR, svenska
  injection-fraser) — och förlitar oss primärt på *strukturell* separation: dokumentinnehåll
  ramas in som data, LLM-utdata valideras mot schema med enum-låsta kontonummer.
- **Refusal-regler per domän.** openaccountants katalogiserar deterministiska hårdstopp för
  Sverige (momsgrupper, vinstmarginalbeskattning, proportionell avdragsrätt …) — fall där
  agenten ska vägra och eskalera till konsulten i stället för att gissa. Vi implementerar
  samma idé som regler i motorn, med eget innehåll.

Betalningar är **hårdblockerade i v1** — inte "kräver godkännande"; de finns inte som handling.

---

## 4. Kundinstans = config, inte kodprojekt

Att onboarda en kund får aldrig betyda "forka ett repo". En kundinstans är **en config-fil**
validerad mot ett schema — och **config-schemat är det första som låses**, för det är
kontraktet mellan plattformen, skillsen och konsult-UI:t.

Kuvertet lånar Difys DSL-mönster (endast mönster — deras licens tillåter inte kodlån):
mallen är **kundneutral**, bindningen till tenant sker i instansieringsögonblicket, och
**secrets ligger aldrig i configen** (Fortnox-/banknycklar refereras med namn, hämtas ur
kundmiljöns secret store):

```jsonc
// customers/kund-a.config.json (illustration — schemat är källan)
{
  "schema_version": "1.0.0",              // semver-gate vid malluppgradering (Dify-mönstret:
  "tenant_id": "kund_a",                  //  MAJOR kräver konsultgodkännande, MINOR varnar)
  "namn": "Café Exempel AB",
  "mall": { "id": "cafe", "version": "1.0.0" },
  "rakenskapsar": "2026-01-01/2026-12-31",
  "moms": { "period": "kvartal" },        // SFL 26 kap: kvartal OK ≤ 40 mnkr underlag
  "kontoplan": { "standard": "BAS2026", "overrides": { "forsaljning_kaffe": "3041" } },
  "approval": { "auto_godkann": false, "beloppsgrans_flagga_sek": 10000 },
  "skills": { "se/moms": "^1.0", "se/bas-kontering": "^1.0", "se/periodisering": "^1.0" },
  "integrationer": { "bokforing": { "typ": "fortnox", "secret_ref": "fortnox/kund_a" } }
}
```

**Branschmallar** är färdiga configar som konsulten justerar i stället för att börja från noll:

| Mall | Det branschspecifika som mallen bär |
|---|---|
| `cafe` | Servering 12 %, livsmedelsinköp (6 % t.o.m. 2027 — se §6), kontantkassa + kort |
| `bygg` | **Omvänd betalningsskyldighet** mellan byggföretag (konton 2614/2647/4425), projektredovisning |
| `konsultbyra` | 25 % tjänstemoms, periodisering av pågående uppdrag |

Mallen är startpunkt, inte facit — konsulten äger justeringen. Det matchar affärsmodellen:
konsulten behåller kundrelationen och omdömet; plattformen bär grovjobbet.

---

## 5. Tvåsidig modell: klientagent + konsultagent

Samma skills-bibliotek, två ansikten:

- **Klientagenten ("mini-CFO")** — företagarens sida. Tar emot kvitton och frågor, förklarar,
  förbereder underlag. Får **aldrig** godkänna bokföring; dess manifest saknar den behörigheten,
  och policy-motorn upprätthåller det oavsett vad LLM:en tycker.
- **Konsultagenten** — byråns sida. Granskningskö, avvikelseflaggning, batchgodkännande.
  openaccountants "reviewer brief"-kontrakt är förebilden för *vad* konsulten ska se per
  förslag: bottom line, flaggor att granska först, vilka konservativa defaults som applicerats
  och varför, vilka underlag som bör begäras in. *"The reviewer is the customer."*

Skillnaden mellan agenterna är **manifest + behörigheter**, inte kod — tesen från §1 bevisad
en gång till.

---

## 6. Svensk rätt som designdrivare

Arkitekturen härleds ur lagkraven. Samtliga rader verifierade mot primärkällor 2026-07-08:

| Rättskälla | Krav | Arkitekturbeslut |
|---|---|---|
| BFL (1999:1078) 5 kap. 6–7 §§ | Verifikation för varje affärshändelse, med: när den sammanställts, när affärshändelsen inträffat, vad den avser, belopp, motpart, hänvisning till underlag, verifikationsnummer | Verifikationstabellens kolumner **är** lagkravens fält; ett förslag kan inte godkännas med luckor |
| BFL 5 kap. 5 § + BFNAR 2013:2 (BFN) | Rättelse ska ange när och av vem; i datorbaserad bokföring sker rättelse genom särskild rättelsepost — bokförda poster raderas aldrig | **Append-only ledger:** databas-rollen saknar UPDATE/DELETE på verifikationstabellen; rättelse = ny rad med referens till den rättade |
| BFL 7 kap. 2 § | Räkenskapsinformation bevaras t.o.m. **sjunde året efter** utgången av det kalenderår då räkenskapsåret avslutades | Retention i datamodellen; GDPR-gallring får aldrig radera räkenskapsinformation — avvägningen är explicit. (Sedan 1 juli 2024 behöver pappersoriginal inte sparas efter digitalisering — säljargument för digital kvittohantering) |
| ML (2023:200) 9 kap. | Momssatser 25 % (generell), 12 %, 6 %. **OBS: livsmedel har tillfälligt 6 % (1 apr 2026 – 31 dec 2027)**; 12 % just nu = restaurang/catering, hotell m.m.; 6 % = livsmedel, böcker, persontransport, kultur, idrott | `se/moms` bär satserna som **datumavgränsade regler** i rules.json — samma kvitto konteras olika beroende på affärshändelsens datum. Detta är versionerade skills motiverade av verkligheten, tre månader gammal |
| ML 16 kap. 13 § | **Omvänd betalningsskyldighet** (lagens nuvarande term) för byggtjänster när köparen är byggföretag; säljaren fakturerar utan moms, köparen redovisar ut- och ingående moms | Bygg-mallen aktiverar regeln; kontering via 2614/2647/4425 (verifierat mot officiella BAS 2025) |
| SFL (2011:1244) 26 kap. 10–11 §§ | Momsdeklaration: månad (huvudregel), kvartal ≤ 40 mnkr beskattningsunderlag, helår ≤ 1 mnkr | `moms.period` i kundconfigen valideras mot gränserna |
| ABL (2005:551) 8 kap. 4 §, 29 §; BFL 2 kap.; Rex (Srf) | Styrelsen/VD ansvarar för att bokföringen fullgörs enligt lag — ansvaret kan inte avtalas bort till konsult eller AI (ytterst BrB 11 kap. 5 §, bokföringsbrott) | **Approval-gaten är inte en feature — den är gällande ansvarsfördelning uttryckt i kod.** Allt AI producerar är förslag tills behörig människa godkänt |
| GDPR | Personuppgifter i verifikationer; isolering; minimering | Tenant-isolering per design (§2); PII-redaktion i audit-flödet; minimering där bevarandeplikten tillåter |
| AI-förordningen (EU) 2024/1689 | Bokföring är **inte** högrisk (ej i bilaga III). Art. 50-transparens (informera att man interagerar med AI; AI-innehåll identifierbart) gäller fr.o.m. 2 aug 2026 — om en månad | Varje förslag loggar skill-versioner, modell-id och input-hash — beslutskedjan är rekonstruerbar per design. UI:t säger att förslag är AI-genererade. (Nämns; fördjupas inte) |

Sista raden i praktiken: eftersom skills är versionerade filer kan varje bokförd verifikation
svara på *"vilka regler, vilken modell, vilket underlag"*. Compliance som biprodukt av
arkitekturen — inte ett efterhandsprojekt.

---

## 7. Datamodell (Postgres + RLS)

Sex tabeller bär flödet. Alla kunddatabärande tabeller har RLS på `tenant_id` — utan undantag
(Dify-läxan: deras tabeller som "ärver" tenant indirekt via joins är omöjliga att auditera).

```
tenants        dokumentkällan          förslagsledet              sanningen
┌─────────┐   ┌────────────┐   ┌──────────────────────────┐   ┌────────────────────┐
│ tenants │◄──┤ documents  │◄──┤ suggestions              │◄──┤ verifications      │
└─────────┘   │ (kvitton,  │   │ (tolkning, konterings-   │   │ (APPEND-ONLY,      │
              │  fakturor) │   │  rader, skill-versioner, │   │  löpnummer per     │
              └────────────┘   │  modell, input-hash)     │   │  tenant; rättelse  │
                               └───────────┬──────────────┘   │  = ny rad m. ref)  │
                               ┌───────────▼──────────────┐   └────────────────────┘
                               │ approvals (vem, när,      │   ┌────────────────────┐
                               │ beslut, förslags-hash)    │   │ audit_log (immut.) │
                               └──────────────────────────┘   └────────────────────┘
```

Append-only upprätthålls i **två lager**: app-rollen saknar UPDATE/DELETE-grant, och
BFL-tabellerna har triggers som kastar exception vid ändringsförsök (ClawKeepers
trigger-mönster, MIT). Verifikationerna får tenant-scopade **löpnummer** — BFL:s
verifikationsnummerkrav — och `approvals` lagrar hashen av det godkända förslaget (§3).

**Verifierat körbart redan nu:** skivan kör **PGlite** (riktig Postgres in-process via WASM —
ingen Docker ikväll). Smoke-testat i denna sessions förarbete: RLS-select-isolering,
`WITH CHECK` mot cross-tenant-skrivning, nekad UPDATE/DELETE för app-rollen, tillåten INSERT
till egen tenant — 5/5 gröna. Produktionsvägen är vanlig Postgres: samma SQL, samma policyer.

---

## 8. Skills-biblioteket i miniatyr (ikväll: 3 skills)

| Skill | Innehåll | Demoroll |
|---|---|---|
| `se/moms` | 25/12/6 med **giltighetsdatum** (livsmedel 12 %→6 % per 2026-04-01), kategoriregler, omvänd betalningsskyldighet bygg, momskonton 2611/2621/2631/2641/2614/2647, deklarationsrutor | Café-kvittot konteras med 6 % — och samma kvitto daterat i mars får 12 %. Regelversionering, bevisad live |
| `se/bas-kontering` | BAS-struktur (officiell BAS 2025-tabell som källa), konteringsregler per affärshändelsetyp, debet=kredit-invariant, praxisnot: 4010 är Fortnox/Visma-konvention, officiella BAS säger 4000 | Kvitto → konteringsrader |
| `se/periodisering` | När kostnader/intäkter periodiseras, trösklar, upplösning | Visar mönstret; körs inte i huvudflödet |

Formatet är openaccountants-kompatibelt (frontmatter + trigger-orienterad description +
numrerade regler + worked examples), men **allt innehåll är vårt eget, skrivet från
primärkällor** — deras filer är AGPL och kopieras inte (§10). Våra skills märks ärligt
`tier: 2` / `verified_by: pending` tills en auktoriserad konsult granskat dem — vägen till
`tier: 1` är exakt den granskningsroll byråkonsulterna kan ta (§1). Worked examples i varje
SKILL.md körs som testfall mot regelmotorn i CI.

**Demofallens facit** (verifierade mot officiella BAS 2025-kontotabellen och Skatteverket):

```
(a) Café: leverantörsfaktura kaffebönor 1 000 kr netto, affärshändelse 2026-07-08 → 6 % moms
    4010  Inköp material/varor          D 1 000,00
    2641  Debiterad ingående moms       D    60,00
    2440  Leverantörsskulder            K 1 060,00

(b) Bygg: underentreprenörsfaktura 10 000 kr, omvänd betalningsskyldighet (ML 16:13)
    4425  Inköpta tjänster, omvänd bet.skyld. 25 %   D 10 000,00
    2440  Leverantörsskulder                          K 10 000,00
    2614  Utgående moms, omvänd bet.skyld. 25 %       K  2 500,00
    2647  Ingående moms, omvänd bet.skyld.            D  2 500,00
    (deklarationsrutor 24/30/48; nettoeffekt noll vid full avdragsrätt)
```

---

## 9. Den vertikala skivan — en kund, ett flöde, hela vägen

**Scope ikväll:** en kund (café-mallen), ett kvitto, hela kedjan, felfritt. Bygg-exemplet
ligger förberett som andra testfall om demon flyter.

```
kvitto (bild/text)
   │  1. injection-check + inramning som data (policy-modul, kod)
   ▼
tolkning — Claude med schema-låst structured output (fält per TaxHacker-mönstret:
   │       datum, motpart, belopp, moms; radposter som items[]). Deterministisk
   │       fallback-mock med samma schema om nyckel/nät fallerar mitt i demon
   ▼
kontering — regelmotorn exekverar se/moms + se/bas-kontering (rules.json):
   │        datumstyrd momssats, enum-låsta konton, debet=kredit-kontroll,
   │        netto+moms=brutto-aritmetik. LLM:en väljer inte konton fritt
   ▼
FÖRSLAG — web-UI: tolkade fält, konteringsrader, momssats, skill-versioner, lagrum
   │
   ▼
konsulten godkänner/avvisar — approval-gate; godkännandet hashar förslaget
   │
   ▼
verifikation skrivs append-only med löpnummer ──► mock-Fortnox kvitterar
```

**Teknik:** TypeScript/Node hela vägen. Next.js för web-UI:t, designgrund via
**Gesso** (`npx gesso-design init` med **studio**-skinnet: varm off-white, editorial serif för
display, terracotta-accent) — samma öppna designgrammatik som resten av husets projekt, och en
diskret demo-poäng i sig: även UI-standarden är open source. PGlite som databas (§7). Anthropic-anrop med nyckel enbart
från env — aldrig argv, aldrig fil i repot. Fortnox och bank mockas bakom ett
adapter-gränssnitt som visar var de riktiga integrationerna pluggas in. Lärdomar från
TaxHacker inbyggda från start: schema-enum i stället för enum-via-prompt, zod-validering av
LLM-utdata med retry, svensk decimal-parsning (komma), belopp i ören som heltal.

**Demo-beats för Mats** (körordning i DEMO.md):

1. Kvittot åker in — tolkningen är riktig AI, live.
2. Förslaget visar momssats, BAS-konton, lagrum och **exakt vilka skill-versioner** som avgjorde.
3. Regelversionering på riktigt: samma kvitto daterat 15 mars → 12 %. Daterat idag → 6 %.
   (Momssänkningen på livsmedel den 1 april är tre månader gammal — det här är inte ett
   hypotetiskt behov.)
4. Approval-gaten — inget når ledgern utan konsultens beslut, och beslutet binds till
   förslagets hash.
5. RLS-demon: byt tenant i UI:t — kund A:s data är borta. Isoleringen är databasen, inte if-satser.
6. Append-only-demon: försök ändra en bokförd verifikation från koden — databasen vägrar.
   Rättelse skapar ny post med referens, per BFL 5:5 + BFNAR 2013:2.

---

## 10. Vad vi lånar och vad som är vårt (sammanfattning av ATTRIBUTION.md)

Licenserna är kontrollerade mot respektive repos LICENSE-filer:

| Källa | Licens | Vad vi tar | Nivå |
|---|---|---|---|
| Alexi5000/ClawKeeper | MIT ✅ | Policy-motor som ren funktion + policyregler som data + gate i basklassen; RLS-SQL-struktur; append-only-triggers; PII-redaktion | Mönster + utvalda kodmönster med attribution. **Vi rättar samtidigt tre dokumenterade svagheter** (session-SET på pool, ENABLE utan FORCE, blind approval_id-tillit) — se §2–3 |
| openaccountants | AGPL-3.0 ⚠️ | **Endast formatet och modellerna** (frontmatter-spec, tier 1/2-verifiering, reviewer brief, refusal-katalogidé). Ingen fil, ingen text kopieras — AGPL är oförenlig med vårt MIT-repo. Eget innehåll från primärkällor, byggt format-kompatibelt för ev. uppströms-bidrag | Format + mönster |
| vas3k/TaxHacker | MIT ✅ | Extraktionsmönstret: fil→bild-normalisering, schema-som-data, prompt-injektion av kundconfig, cachat parse-resultat + mänsklig granskning | Mönster (ev. kodfragment med attribution). Kända svagheter åtgärdade (schema-enum, utdatavalidering, aritmetikkontroll) |
| e2b-dev/E2B + infra | Apache-2.0 ✅ | Exekveringslagrets referensmönster: microVM per kund, snapshot-paus, template = config | Enbart referens i plan |
| langgenius/dify | Dify OSL (Apache-2.0 + villkor) ⚠️ | Config-DSL-kuvertet, semver-gate vid mallimport, tenant-neutral mall + tenant-bunden instans, secrets utanför config | **Enbart mönster, ingen kod** (licensen förbjuder det) |

**Vår moat, uttalat:** den svenska domänen som versionerade, maskinexekverbara skills (BAS,
svensk moms med gällande satser, bokföringslagen, Skatteverkets praxis) — verifierade av
riktiga konsulter; branschmallarna; tvåsidiga modellen anpassad till konsult-affären; och
distributionen genom byråerna. Allt annat är commodity och lånas öppet.

---

## 11. Efter ikväll (utanför scope, riktning)

1. **Riktig Fortnox-integration** bakom samma adapter som mocken; SIE-export.
2. **Fler svenska skills:** arbetsgivaravgifter/löner, bokslut (K2/K3), momsdeklaration
   (rutor → SKV-format), e-faktura (Peppol).
3. **Exekveringslagret på riktigt:** per-kund-miljöer (E2B self-host/Fly Machines, EU-region).
4. **Konsultagentens kö-vy:** batchgranskning över kunder — byråns faktiska arbetsyta.
5. **Uppströms-relation till openaccountants:** efter CLA-beslut — svensk modul + byråkonsulter
   som namngivna tier 1-granskare.
6. **Accountant-verified:** lyft skillsens verifieringsnivå med riktiga konsulters granskning.

---

## 12. Öppna punkter och medvetna risker

- **Publik repo-hygien:** inga kund- eller bolagsnamn ur verkligheten i repot; demo-datat är
  påhittat. Planen säger "större byråer", inget mer.
- **CLA-beslutet:** uppströms-bidrag till openaccountants ger deras ägarbolag rätt att sälja
  vårt svenska innehåll kommersiellt (dual-licens). Strategiskt beslut för Mats — inte vårt,
  och inget som behöver avgöras ikväll. Repot byggs format-kompatibelt så dörren står öppen.
- **BAS 2026:** kontoklass 4 har fått större ändringar i BAS 2026 — kontona i demon är
  verifierade mot officiella BAS 2025-tabellen; stäm av mot BAS 2026 före produktion.
- **LLM/regel-gränsen:** v1 låter LLM:en tolka dokumentet men reglerna välja konton. Gränsen
  är medvetet konservativ och kommer justeras med erfarenhet.
- **Skills-versionering:** semver per skill räcker ikväll; på sikt behövs lockning per kund
  (configen pekar på exakta versioner vid godkännandetillfället — mönstret finns i §4-kuvertet).
- **Stack-portabilitet:** referensimplementationen är TypeScript, men mönstren (skills som
  markdown + JSON-data, RLS, policy-motor, config-schema) är språkoberoende — planen antar
  inget om befintlig stack.
