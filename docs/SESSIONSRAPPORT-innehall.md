# Sessionsrapport — innehållspasset + underlagsjakten (WP30–WP34)

Nattpass 2026-07-18/19, gren `innehall-underlagsjakt`, en commit per WP.
Hela testsviten grön mellan varje WP (183 tester vid start → 208 vid slut,
plus adversariell granskning före PR). PR öppnad — **inte** mergad.

## Blockering upptäckt vid start: TESTUNDERLAG-GOLDEN.md finns inte

Kickoffen pekar på `TESTUNDERLAG-GOLDEN.md` "i docs/ eller repo-roten".
Filen finns varken där, i git-historiken (`git log --all --diff-filter=A`)
eller i stasharna, och `testdata/underlag/` är tom. Beslut enligt regeln
"gissa aldrig vidare":

- Fall 1–5, 7, 8 beskrivs tillräckligt i kickoffen själv — de är
  implementerade mot kickoffens beskrivningar, med egna textrepresentationer
  (påhittade namn/nummer, `tests/golden-underlag.ts`).
- **Fall 6 är BLOCKERAT** och medvetet oimplementerat. Blockeringen är
  dokumenterad i `testdata/expected/fall-6.json` och bevakad av ett
  vakttest som smäller den dag TESTUNDERLAG-GOLDEN.md landar i repot —
  då ska fall 6 implementeras och blockeringen hävas.

## WP30 — riktiga systempromptar per roll (`decb6cf`)

Stubbarna i `src/mallar/registry.ts` ersatta med fullständiga rollpromptar
för `bokforing`, `lon`, `skatt-compliance`, `leverantorsreskontra`.

- Gemensam **obligatorisk granskningsordning** i alla fyra (mottagarkontroll
  FÖRST → `flag_wrong_tenant` + ingen kontering; privat →
  `flag_private_expense`; förskott → 1480; delmatchning →
  `missing_receipt` + restbelopp; dubblett leverantör+belopp+period;
  beloppsanomali → `anomaly_amount`), eskaleringsregler och kravet att
  output ALLTID är giltig Proposal v0.3.
- Rollspecifika gränser: lön auto-godkänns aldrig och refererar
  anställningsnummer (aldrig namn/personnummer); skatt är
  compliance-avgränsad (ADR-0005, ingen rådgivning); reskontran verkställer
  aldrig betalningar och vaktar fakturakapning (nytt/ändrat bankgiro).
- Versionering: minor-bump **1.0.0 → 1.1.0** på alla fyra mallar —
  agentpekare på major `1` följer med automatiskt (ADR-0004).
- Tester låser promptkraven (flagg-id:n, ordning, kontraktskrav) per roll.

## WP31 — branschpaketen in i LLM-vägen (`a367df0`)

- Ny `byggSystemPrompt(mall, tenantMall)`: rollprompten + `effektivaRegler`
  (mallens + tenantens aktiva branschpakets regler) → den kompletta
  systemprompt jobbet kör med. Enda vägen från paket till LLM.
- Workern slår upp `tenants.mall` per jobb och väver prompten — ett
  branschbyte hos tenanten slår igenom utan agentmigration (ADR-0005).
- Anthropic-vägen: rollkontexten läggs EFTER extraktionsskyddsreglerna
  (dokument-är-data-reglerna är ovillkorliga). Fallbacken är deterministisk
  och promptokänslig per definition.
- `provenance.prompt_hash` bär nu hela den sammanvävda prompten — ett
  bumpat branschpaket syns i revisionsspåret.
- Bygg-paketet: + `ata-vaksamhet` (ÄTA-avvikelse mot känt ordervärde →
  needs_review). Restaurang: `livsmedelsmoms` uttryckligen DATUMSTYRD
  (12 % → 6 % fr.o.m. 2026-04-01 t.o.m. 2027-12-31, åter 12 % 2028 — allt
  ur `se/moms rules.json`-perioder, aldrig hårdkodad sats);
  `kassarapport` kvar som uttalad stub. Paketen 1.0.0 → 1.1.0.
- Golden-test: samma underlag hos tenant med/utan paket → olika
  promptinnehåll och olika prompt_hash.

**Avvikelse-not:** kickoffen skriver "2617/2647-logik" för omvänd byggmoms.
Repots `se/moms rules.json` använder medvetet **2614**/2647 med dokumenterad
motivering ("2617 finns inte i officiella BAS — programvarukonvention",
verifierat mot BAS 2025). Kontovalet är därför inte ändrat; kickoff-frasen
läses som mekanismbeskrivning.

## WP32 — de åtta fallen som golden-tester (`b1a498a`)

- Ny deterministisk **granskningsmotor** `src/lib/granskning.ts` —
  implementationen av promptarnas granskningsordning. LLM:en/fallbacken
  RAPPORTERAR observationer; motorn BESLUTAR (flaggor, eskalering,
  kontoval). Samma motor oavsett tolkningsmotor.
- Extraktionsschemat utökat med observationsfält (alla med default —
  äldre payloads/testliteraler validerar oförändrat): `mottagare`,
  `forskott`, `privat_indikation`, `order_ref`, `rest_utan_underlag_ore`.
  Fallbacken parsar dem ur märkta rader i textrepresentationen.
- "Ingen kontering" är kontraktstroget implementerad som
  `advisory_answer`-eskalering (kontraktet kräver ≥2 rader för
  journal_entry) — inga rader, ingen ledger-effekt, confidence 0.2,
  summary `ESKALERING (ingen kontering): …`.
- Modulens flaggor persisteras nu i `proposals.flaggor`: `buildProposal`
  returnerar `{ proposal, flaggor }` och porten tar emot dem som **betrodd
  runtime-metadata** (parameter, aldrig ur payloaden — en extern agents
  egen utsaga om sina flaggor är värdelös som kontroll).
- ÄTA: kända ordervärden i kundconfig (`ordrar`, nytt schemafält i
  `config.schema.json`); kontrollen körs endast när tenantens bransch
  aktiverar bygg-paketet.
- Dubblett: leverantör+belopp+period mot både tidigare förslag och
  bokförda verifikationer. Anomali: >2× median (≥3 historiska
  verifikationer) → `anomaly_amount` (info-nivå: **bokför men notifiera**)
  + telemetrisignal `telemetri_anomaly_amount` i audit-loggen.
- Golden-sviten (`tests/golden-fall.test.ts`) kör hela workervägen
  (mallstämplad agent → kö-jobb → tolka → granskning → kontering → port)
  mot facit i `testdata/expected/fall-*.json` (committade; endast
  Exempel-bolag, inga persondata — vakttest kontrollerar). Sviten är
  strukturerad för riktig LLM: `GRUNDBOK_GOLDEN_LIVE=1` + API-nyckel byter
  motor, samma facit.
- **Fynd åtgärdat under WP32:** `momssats_avviker` falsklarmade vid omvänd
  byggmoms — säljaren SKA fakturera utan moms, dokumentets 0 kr är
  korrekt. Kontrollen hoppar nu över omvand-typen.

Tolkningar gjorda (dokumenterade, inte gissade i blindo — textformerna är
nattens kontrakt, PDF-verifiering återstår):

- **Fall 5 (delmatchning):** transaktionen konteras i sin helhet och
  restbeloppet flaggas/jagas som komplettering — ett delbokfört belopp
  hade brutit mot underlag↔transaktionsmatchningen åt andra hållet.
- **Fall 4 (privat):** ingen kostnadskontering alls (eskalering) — att
  välja t.ex. 2893-hantering åt konsulten vore en gissning.

## WP33 — underlagsjakten / kompletteringskön (`3d36190`)

- Tabell `kompletteringar` (tenant_id, agent_id, proposal_id, typ
  `missing_receipt`/`fraga`, belopp_ore, beskrivning, status
  `open`/`paminnd`/`klar`, svar, skapad, senast_paminnd) med RLS som
  övriga kunddatatabeller; grants: uppdaterbar (status/svar/påminnelse),
  aldrig raderbar.
- Porten skapar **automatiskt** en kompletteringsrad ur
  missing_receipt-flaggade förslag (restbeloppet ur flaggdatan).
- Byråvyn, ny flik **"Väntar på kunden"**: lista per klient med typ,
  belopp, ålder i dagar och status; **Påminn**-knappen markerar öppna
  rader påminda och öppnar ett färdigt vänligt mejlutkast via `mailto:`
  (mejladaptern kommer i intag-passet); svar registreras i fritextfält.
- **"Fråga kunden"** i attestkons detaljpanel → kompletteringsrad typ
  `fraga`; när svaret registreras fästs hela fråga→svar-kedjan vid
  förslaget i audit-loggen (`kompletteringssvar` — Rex-dokumentationen).
- **Månadsgrönt v0:** chip per klient i "Väntar på kunden"-fliken — grön
  när attestkön OCH kompletteringskön är tomma, beräknat ur nuläget
  (aldrig lagrade räknare, samma princip som telemetrivyn). Kickoffens
  "chip i klientlistan" tolkades som per-klient-raderna i fliken —
  klientVÄLJAREN är en `<select>` som inte kan bära chips.

## WP34 — smoke + granskning + rapport (denna commit)

- E2E-kedjan i `tests/e2e-smoke.test.ts`: underlag med saknat kvitto →
  delmatchad Proposal (pending, missing_receipt persisterad) →
  kompletteringsrad auto-skapad → konsult ställer fråga → båda svaren
  Rex-loggade vid förslaget → attest → månadschip gul (1 att attestera,
  2 hos kunden) → grön (0/0).
- Hela sviten: **208 tester gröna**, `tsc --noEmit` rent, `next build` ok.

### Adversariell granskning

Åtta oberoende granskningsvinklar (radgranskning, borttagna beteenden,
korsfilsspårning, återbruk, förenkling, effektivitet, altitud,
konventioner) kördes mot hela diffen. Äkta fynd åtgärdade i
granskningscommiten; regressionstester i `tests/granskning.test.ts`.

**Åtgärdade korrekthetsfynd:**

1. **Dubblettdetekteringen missade omvänd byggmoms** (allvarligast):
   jämförelsen använde debetsumman (netto+moms vid omvänd) mot
   dokumenttotalen (netto) — en dubblerad underentreprenörsfaktura
   flaggades aldrig. Nu matchas beloppet mot både debetsumman och största
   kreditraden (leverantörsskulden bär "att betala" i båda formerna).
2. **Intagsvägen körde ingen granskning alls**: `/api/byra/intag/forslag`
   gick tolka→kontera rakt förbi mottagarkontroll, förskott→1480 och
   missing_receipt→komplettering — två ingångar med olika regler för
   samma underlag. Nu kör routen samma `granskaUnderlag`; eskaleringsfall
   (fel mottagare, privat) stoppas med 422 och tydligt skäl, övriga fynd
   följer med som flaggor + kontoöverstyrning.
3. **Momsvakten för omvänd moms var helt avstängd** (överkorrigering av
   WP32-fyndet): en säljare som felaktigt DEBITERAR moms på en omvänd
   faktura flaggades inte. Nu: 0 kr är korrekt; debiterad moms ≠ 0 →
   varning ("att betala ≠ netto — stäm av med leverantören").
4. **`Betalningsmottagare:` i betalfoten fångades som fakturamottagare**
   (substring-träff på "mottagare") → leverantörens namn jämfördes mot
   tenanten → falskt `flag_wrong_tenant` på giltiga fakturor. Regexen är
   nu radankrad.
5. **Mottagarmatchningen var substring-baserad och diakritikkänslig**:
   tenanten "Bygg AB" matchade mottagaren "Byggmax AB" (missad
   wrong-tenant) och "Cafe"≠"Café" falsklarmade (OCR tappar accenter).
   Nu: diakritikvikning + ordmängdsjämförelse.
6. **Telemetrihändelsen `anomaly_amount` skrevs före portbeslutet** i
   granskningens egen transaktion — varje kö-omkörning av samma jobb hade
   lämnat en extra rad i den append-only audit-loggen. Signalen skrivs nu
   av porten, efter idempotenskontrollen, atomärt med förslaget.
7. **Förskottsdetekteringen övermatchade**: en slutfaktura som bara
   AVRÄKNAR ett tidigare a conto hade konterats 1480. Slut-/kreditfaktura-
   mönster undantar nu.
8. **ÄTA-regeln aktiverades av enbart tenantens bransch**, inte
   mall∩tenant-snittet — en mall-lös agent hos byggtenant körde en
   paketregel som ingenting aktiverat (och som prompt/prompt_hash inte
   nämnde). Aktiveringen beräknas nu EN gång i workern
   (`aktivaBranschpaket`) och skickas in som kontext.
9. **Tre förexisterande ospårade filer följde med av misstag** i första
   commiten (`git add -A`): `designurval.html`, `KICKOFF-INNEHALL.md`,
   `KICKOFF-INTAG.md` — urplockade ur grenen (kvar på disk).
10. **Rollprompten motsade extraktionsschemat på riktiga LLM-vägen**
    ("Output ALLTID en giltig Proposal" i ett anrop som schema-låser
    Extraktion → parse-fall → tyst fallback-degradering). Anropet
    avgränsar nu explicit att endast extraktionssteget utförs, och
    extraktions-SYSTEM instruerar observationsfälten uttryckligen.

**Åtgärdade städfynd:** `fmtKr` fanns i tre kopior (nu importerad från
kontering); `kostnad`/`kostnadDef`/`kostnadskonto`-trippeln i kontera
hopdragen till ett (konto, namn)-par beräknat en gång; O(n²)-dedup i
porten → Map; Påminn gick från N sekventiella POST (icke-atomärt) till en
POST/en transaktion/en audit-händelse; `kompletteringarForByra` halverade
antalet transaktioner (rader + månadsstatus i samma withTenant);
anomalihistoriken tidsavgränsad till 24 månader; badge-IIFE i flikraden →
förberäknad konstant.

**Kända, medvetet oåtgärdade (dokumenterade):**

- Eskaleringar återanvänder kind `advisory_answer` — attest-UI:ts
  bekräftelsetext ("rådgivningssvar bokförs inte") är missvisande för en
  fel-mottagare-eskalering, och en tenant som själv lägger
  advisory_answer i bokforing-policyns tillåtna kinds skulle kunna
  auto-godkänna eskaleringar (ingen UI-väg gör det i dag). En egen
  eskalerings-kind är en kontraktsändring (v0.4) — fel storlek för
  natten. Summary-prefixet `ESKALERING (ingen kontering):` är
  markören tills dess.
- `mailto:`-utkastets längd kan överstiga vissa klienters URL-gräns vid
  många öppna rader — accepterat tills mejladaptern (intag-passet).
- Fallback-heuristikerna för `privat_indikation` (ordet "privat" i en
  rad) är medvetet grova textrepresentations-heuristiker; utfallet är
  alltid eskalering till konsult, aldrig automatik. Riktig LLM gör
  bedömningen på riktiga underlag.
- Testhjälpare (`skapaDokument`, `tuples`) duplicerade över testfiler —
  flytt till `tests/helpers.ts` är en ren teststädning för ett senare
  pass.

## Vad som återstår (medvetet utanför natten)

- **Fall 6**: blockerat tills TESTUNDERLAG-GOLDEN.md finns (se ovan).
- **PDF-verifiering av golden-fallen**: textrepresentationerna är nattens
  kontrakt; när verkliga PDF:er läggs i `testdata/underlag/` ska samma
  svit köras mot PDF-extraktion (och mot riktig LLM via
  `GRUNDBOK_GOLDEN_LIVE=1`).
- **Mejladaptern**: Påminn är `mailto:` i natt; riktig utskicks-/
  intagsadapter hör till intag-passet (KICKOFF-INTAG.md).
- **Intags-UI:t saknar eskaleringsrendering**: granskningsmotorn körs nu
  även i intagsvägen (granskningsfynd 2), men eskaleringsfallen stoppas
  som 422-fel med skäl i stället för att visas som eskaleringsförslag —
  UI-flödet för det hör till intag-passet.
- **Kassarapportlogiken**: uttalad stub i restaurang-paketet.
- **Beslutslogg-UI:t visar inte kompletteringssvaren**: kedjan ligger i
  audit-loggen (Rex) och i "Väntar på kunden"-fliken; att rendera
  audit-kommentarer inline i beslutslogg-fliken är en liten UI-uppgift
  för ett kommande pass.
