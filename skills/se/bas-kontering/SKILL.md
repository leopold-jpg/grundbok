---
name: se-bas-kontering
description: >-
  Konteringsregler mot BAS-kontoplanen för svenska kvitton och leverantörsfakturor.
  Triggas av frågor som: kontera det här kvittot, bokför leverantörsfakturan,
  vilket BAS-konto ska kaffebönor/kontorsmaterial/IT-tjänster på, hur konteras
  omvänd betalningsskyldighet för byggtjänster, vad måste en verifikation
  innehålla, hur rättas en felbokförd verifikation. Täcker kontoklassernas
  struktur, kostnadskonton per kategori, motkonton (2440 leverantörsskulder,
  1930 företagskonto), ingående moms på 2641, omvänd betalningsskyldighet
  (4425/2614/2647), invarianterna debet=kredit och netto+moms=brutto,
  flaggregler samt rättelse enligt BFL 5 kap. 5 § och BFNAR 2013:2.
  Momssatser hämtas ur se-moms.
jurisdiction: SE
category: bokforing
tax_year: 2026
tier: 2
verified_by: pending
version: 1.0.0
last_updated: 2026-07-08
depends_on:
  - se-moms
---

> **Tier 2 — källciterat AI-utkast.** Innehållet är skrivet från och verifierat mot
> primärkällor (riksdagen.se, Skatteverket, BFN, bas.se) 2026-07-08, men har ännu
> inte granskats av en auktoriserad redovisningskonsult. Allt systemet producerar
> med stöd av denna skill är **förslag** som kräver mänskligt godkännande innan
> bokföring. Ansvaret för att bokföringen fullgörs enligt lag ligger alltid hos den
> bokföringsskyldige — styrelsen och VD i ett aktiebolag — och kan inte överlåtas
> till konsult eller AI (ABL (2005:551) 8 kap. 4 § och 29 §; BFL (1999:1078)
> 2 kap.; Rex, Srf konsulterna; straffrättsligt ytterst BrB 11 kap. 5 §,
> bokföringsbrott).

## Omfattning

**Täcker:**

- Översättning av en tolkad leverantörsfaktura eller ett kvitto till konteringsrader
  mot BAS-kontoplanen: kostnadskonto per kategori, motkonto, momskonto.
- Verifikationskraven i BFL (1999:1078) 5 kap. 6–7 §§ som hård regel för vad ett
  konteringsförslag måste innehålla för att kunna godkännas.
- Omvänd betalningsskyldighet för byggtjänster på köparens sida
  (ML (2023:200) 16 kap. 13 §).
- Invarianter (blockerande) och flaggregler (kräver konsultens blick).
- Rättelse av bokförd verifikation (BFL 5 kap. 5 § och BFNAR 2013:2).

**Täcker inte:**

- Momssatser och deras giltighetsdatum — de ägs av `se-moms` (denna skill hämtar
  sats via kategori + affärshändelsedatum därifrån).
- Intäktssidan/kundfakturor (utom noten om säljarens konto 3231 vid omvänd
  betalningsskyldighet), löner (kontoklass 7), periodisering (`se-periodisering`),
  bokslut och momsdeklarationens upprättande.
- Avdragsrättens gränser i detalj (t.ex. representation) — sådana fall konteras
  konservativt och flaggas alltid för konsult.

## Regler

`rules.json` i samma katalog är den maskinläsbara motsvarigheten till det här
dokumentet och är vad den deterministiska regelmotorn faktiskt exekverar.
SKILL.md och rules.json får aldrig glida isär: worked examples nedan körs som
testfall mot motorn i CI, så en ändring i den ena filen utan den andra bryter
bygget. LLM:en läser denna fil för att förklara och resonera; kontovalen görs av
motorn med enum-låsta kontonummer — LLM:en väljer aldrig konton fritt.

### 1. BAS-kontoplanens struktur

BAS-kontoplanen förvaltas av BAS-intressenternas Förening. Kontona i denna skill
är verifierade mot den officiella BAS 2025-kontotabellen (bas.se).

| Kontoklass | Innehåll |
|---|---|
| 1 | Tillgångar (t.ex. 1930 Företagskonto) |
| 2 | Eget kapital och skulder (t.ex. 2440 Leverantörsskulder, momskontona 26xx) |
| 3 | Rörelsens inkomster och intäkter |
| 4 | Utgifter/kostnader för varor, material och vissa köpta tjänster |
| 5–6 | Övriga externa rörelseutgifter/kostnader |
| 7 | Utgifter/kostnader för personal, avskrivningar m.m. |
| 8 | Finansiella och andra inkomster/intäkter och utgifter/kostnader |

> **BAS 2026-not:** kontoklass 4 har fått större ändringar i BAS 2026. Denna
> version (1.0.0) är verifierad mot BAS 2025-tabellen — stäm av kontoklass 4 mot
> BAS 2026 före produktionssättning.

### 2. Verifikationskravet — vad ett förslag måste innehålla

BFL (1999:1078) 5 kap. 6 §: det ska finnas en verifikation för varje
affärshändelse. BFL 5 kap. 7 § räknar upp verifikationens innehåll — och
förslagsobjektets fält **är** lagkravens fält:

| # | Krav (BFL 5 kap. 7 §) | Fält i förslaget |
|---|---|---|
| 1 | När verifikationen sammanställts | `skapad_tidpunkt` — sätts av systemet |
| 2 | När affärshändelsen inträffat | `affarshandelse_datum` — styr momssatsen (se `se-moms`) |
| 3 | Vad affärshändelsen avser | `beskrivning` |
| 4 | Belopp | `netto`, `moms`, `brutto` — ören som heltal |
| 5 | Vilken motpart den berör | `motpart` |
| 6 | Hänvisning till underlag | `dokument_id` — kvittot/fakturan i dokumenttabellen |
| 7 | Verifikationsnummer eller motsvarande | löpnummer per tenant, sätts av ledgern vid bokföring |

Invarianten `verifikationens_innehall` upprätthåller detta: ett förslag utan
affärshändelsedatum, belopp, motpart eller beskrivning **kan inte godkännas**.

### 3. Kostnadskonto per kategori

Kategorierna nedan speglar `kostnadskonton` i rules.json exakt. Konton ur
officiella BAS 2025-kontotabellen (bas.se) om inget annat anges.

| Kategori | Konto | Namn | Not |
|---|---|---|---|
| `livsmedel` | 4010 | Inköp material och varor | 4010 är de facto-standard i Fortnox/Visma; **officiella BAS definierar 4000** "Inköp av varor från Sverige". Konfigurerbart per kund (se regel 9). |
| `restaurang_catering` | 6072 | Representation, ej avdragsgill | Förenklad regel i skivan: extern representation. Avdragsrätten för representationsmoms är begränsad — **flaggas alltid** för konsultgranskning. |
| `byggtjanst_omvand` | 4425 | Inköpta tjänster i Sverige, omvänd betalningsskyldighet, 25 % | Se regel 6. |
| `kontorsmaterial` | 6110 | Kontorsmateriel | |
| `it_tjanster` | 6540 | IT-tjänster | |
| `bocker_tidningar` | 6970 | Tidningar, tidskrifter och facklitteratur | |
| `persontransport` | 5800 | Resekostnader | |
| `hotell` | 5800 | Resekostnader (logi) | |
| `kultur_idrott` | 6993 | Lämnade bidrag och gåvor / övrigt | Kontextberoende — flaggas för konsult. |
| `ovrigt` | 6991 | Övriga externa kostnader, avdragsgilla | Fallback när ingen kategori matchar. |

### 4. Motkonton

| Betalningssituation | Konto | Namn | Sida |
|---|---|---|---|
| Leverantörsfaktura (betalas senare) | 2440 | Leverantörsskulder | Kredit |
| Direktbetalning (kvitto, betalt med företagskonto/kort) | 1930 | Företagskonto/checkkonto/affärskonto | Kredit |

### 5. Ingående moms — alltid 2641

Ingående moms debiteras **2641 Debiterad ingående moms** oavsett momssats —
BAS delar inte upp ingående moms per sats (verifierat mot officiella BAS
2025-tabellen). Konto 2617 finns **inte** i officiella BAS; det är en
programvarukonvention och används inte här. Momssatsen bestäms av `se-moms`
utifrån kategori och affärshändelsedatum — aldrig av denna skill. Utgående moms
vid försäljning (2611 för 25 %, 2621 för 12 %, 2631 för 6 %) ligger också i
`se-moms` och berörs här endast via omvänd betalningsskyldighet (regel 6).

### 6. Omvänd betalningsskyldighet — byggtjänster

Lagrum: ML (2023:200) 16 kap. 13 §. Lagens nuvarande term är **omvänd
betalningsskyldighet** (tidigare "omvänd skattskyldighet").

- **Villkor:** byggtjänster (mark- och grundarbeten, bygg- och
  anläggningsarbeten, bygginstallationer, slutbehandling av byggnader, uthyrning
  av bygg- och anläggningsmaskiner med förare, byggstädning samt uthyrning av
  arbetskraft för dessa tjänster) där köparen är en beskattningsbar person som i
  sin verksamhet inte endast tillfälligt tillhandahåller sådana tjänster, eller
  en mellanman som vidareförsäljer till en sådan köpare.
- **Säljaren** fakturerar **utan moms** och redovisar intäkten på konto 3231.
- **Köparen** redovisar både utgående och ingående moms:

| Roll i konteringen | Konto | Namn | Sida |
|---|---|---|---|
| Kostnad | 4425 | Inköpta tjänster i Sverige, omvänd betalningsskyldighet, 25 % | Debet |
| Skuld till leverantör | 2440 | Leverantörsskulder | Kredit |
| Utgående moms (beräknad, 25 %) | 2614 | Utgående moms omvänd betalningsskyldighet, 25 % | Kredit |
| Ingående moms (samma belopp vid full avdragsrätt) | 2647 | Ingående moms omvänd betalningsskyldighet | Debet |

- **Deklarationsrutor:** 24 (underlag), 30 (utgående moms 25 %), 48 (ingående
  moms). Vid full avdragsrätt är nettoeffekten på momsen noll.

### 7. Invarianter — blockerande

Speglar `invarianter` i rules.json. Bryts en invariant kan förslaget inte gå
vidare till godkännande.

| Id | Regel | Lagrum/källa |
|---|---|---|
| `debet_kredit_balans` | Summan av debet ska exakt motsvara summan av kredit i varje verifikation. | Dubbel bokföring; grundkrav i BAS-strukturen (bas.se) |
| `netto_moms_brutto` | netto + moms = brutto, räknat i ören med heltalsaritmetik. Avvikelse > 1 öre blockerar förslaget. | Aritmetisk konsistens mot underlaget (BFL 5 kap. 7 §: belopp) |
| `verifikationens_innehall` | Förslag utan affärshändelsedatum, belopp, motpart eller beskrivning kan inte godkännas. | BFL (1999:1078) 5 kap. 7 § |

### 8. Flaggregler — icke-blockerande, kräver konsultens blick

Speglar `flaggor` i rules.json. En flagga stoppar inte förslaget men markerar det
i konsultens granskningskö.

| Id | Regel |
|---|---|
| `belopp_over_grans` | Brutto över kundens `beloppsgrans_flagga_sek` (kundconfig) markeras för extra granskning. |
| `momssats_avviker` | Om kvittots angivna momssats avviker från regelverkets sats för kategorin + datumet flaggas förslaget. **Regelverkets sats ersätter aldrig kvittots tyst** — konsulten avgör vilken som gäller. |

### 9. Kundöverstyrningar

En kundinstans får via `config.schema.json` sätta `konto_overrides` per kategori
(t.ex. `{ "livsmedel": "4000" }` för en kund som följer officiella BAS i stället
för Fortnox/Visma-praxis) samt `beloppsgrans_flagga_sek`. **Invarianterna i
regel 7 är inte konfigurerbara.**

### 10. Rättelse — aldrig radering

Lagrum: **BFL (1999:1078) 5 kap. 5 § tillsammans med BFNAR 2013:2 (BFN)** —
citera alltid båda tillsammans: paragrafen ger rättelsekravet, det allmänna
rådet ger förbudet mot radering i datorbaserad bokföring.

- En rättelse ska ange **när** den gjorts och **av vem** (BFL 5 kap. 5 §).
- Rättelsen sker genom en **särskild rättelsepost** med full spårbarhet till den
  rättade verifikationen; i datorbaserad bokföring raderas eller ändras bokförda
  poster aldrig (BFNAR 2013:2).
- I systemet: ledgern är append-only — databasrollen saknar UPDATE/DELETE på
  verifikationstabellen. Rättelse = **ny verifikation med referens** till den
  rättade, med eget löpnummer, konsultens identitet och tidpunkt.

### 11. Bevarande

Räkenskapsinformation bevaras till och med **sjunde året efter** utgången av det
kalenderår då räkenskapsåret avslutades (BFL 7 kap. 2 §). Retention ligger i
datamodellen; GDPR-gallring får aldrig radera räkenskapsinformation under
bevarandetiden.

## Worked examples

Exemplen körs som testfall mot regelmotorn i CI — beloppen och kontona nedan är
facit, inte illustrationer. Alla namn är påhittade.

### Exempel A1 — café, leverantörsfaktura kaffebönor (6 % livsmedel)

**Input**

- Köpare: Café Exempel AB (mall `cafe`)
- Motpart: Kafferosteriet Exempel AB
- Underlag: leverantörsfaktura, kaffebönor
- Netto: 1 000,00 kr — affärshändelsedatum: **2026-07-08**
- Kategori: `livsmedel`

**Resonemang**

1. Kategori `livsmedel` → kostnadskonto 4010 (regel 3; kundens
   `konto_overrides` har företräde, ingen satt här).
2. `se-moms` ger sats för `livsmedel` per 2026-07-08 → **6 %** (tillfällig sats
   1 april 2026 – 31 december 2027, prop. 2025/26:55, bet. 2025/26:SkU9).
3. Ingående moms → 2641 oavsett sats (regel 5). Moms: 1 000,00 × 6 % = 60,00.
4. Leverantörsfaktura → motkonto 2440 kredit (regel 4). Brutto: 1 060,00.

**Konteringsrader**

| Konto | Namn | Debet | Kredit |
|---|---|---:|---:|
| 4010 | Inköp material och varor | 1 000,00 | |
| 2641 | Debiterad ingående moms | 60,00 | |
| 2440 | Leverantörsskulder | | 1 060,00 |

**Kontroller:** debet 1 060,00 = kredit 1 060,00 ✓ · 100 000 + 6 000 =
106 000 ören ✓ · alla BFL 5:7-fält ifyllda ✓

### Exempel A2 — samma kvitto, daterat före satsändringen (12 %)

**Input:** identiskt med A1, men affärshändelsedatum **2026-03-15**.

**Resonemang:** samma kontoval; `se-moms` ger för `livsmedel` per 2026-03-15
→ **12 %** (livsmedel hade 12 % före 2026-04-01). Samma kvitto, annat datum,
annan kontering — det är därför momssatserna är datumavgränsade regler och
inte konstanter.

**Konteringsrader**

| Konto | Namn | Debet | Kredit |
|---|---|---:|---:|
| 4010 | Inköp material och varor | 1 000,00 | |
| 2641 | Debiterad ingående moms | 120,00 | |
| 2440 | Leverantörsskulder | | 1 120,00 |

**Kontroller:** debet 1 120,00 = kredit 1 120,00 ✓ · 100 000 + 12 000 =
112 000 ören ✓

### Exempel B — byggföretag, omvänd betalningsskyldighet

**Input**

- Köpare: Bygg Exempel AB (mall `bygg`; byggföretag som inte endast tillfälligt
  tillhandahåller byggtjänster)
- Motpart: Underentreprenad Exempel AB
- Underlag: faktura för byggtjänst, **utan moms**, med uppgift om omvänd
  betalningsskyldighet
- Belopp: 10 000,00 kr

**Resonemang**

1. Byggtjänst + köparen är ett byggföretag → omvänd betalningsskyldighet enligt
   ML 16 kap. 13 § (regel 6). Säljaren har korrekt fakturerat utan moms (och
   redovisar själv intäkten på 3231).
2. Kostnad → 4425 debet. Skuld → 2440 kredit, 10 000,00.
3. Köparen beräknar utgående moms 25 % på underlaget: 2 500,00 → 2614 kredit.
4. Full avdragsrätt → samma belopp som ingående moms: 2 500,00 → 2647 debet.
5. Deklarationsrutor: 24 (underlag 10 000), 30 (utgående 2 500), 48 (ingående
   2 500). Nettoeffekt på momsen: noll.

**Konteringsrader**

| Konto | Namn | Debet | Kredit |
|---|---|---:|---:|
| 4425 | Inköpta tjänster i Sverige, omvänd betalningsskyldighet, 25 % | 10 000,00 | |
| 2440 | Leverantörsskulder | | 10 000,00 |
| 2614 | Utgående moms omvänd betalningsskyldighet, 25 % | | 2 500,00 |
| 2647 | Ingående moms omvänd betalningsskyldighet | 2 500,00 | |

**Kontroller:** debet 12 500,00 = kredit 12 500,00 ✓ · 2614 och 2647 speglar
varandra ✓ · rutor 24/30/48 satta ✓

## Självkontroller

Innan ett förslag lämnas till konsulten:

- [ ] Summan av debet = summan av kredit (invariant `debet_kredit_balans`).
- [ ] netto + moms = brutto i ören, heltalsaritmetik (invariant `netto_moms_brutto`).
- [ ] Alla verifikationsfält enligt BFL 5 kap. 7 § är ifyllda: affärshändelsedatum,
      beskrivning, belopp, motpart, hänvisning till underlag (invariant
      `verifikationens_innehall`).
- [ ] Momssatsen är hämtad ur `se-moms` för kategorin **och** affärshändelsens
      datum — aldrig antagen eller hårdkodad.
- [ ] Kvittots angivna momssats är jämförd med regelverkets; avvikelse har flaggats
      (`momssats_avviker`) — regelverkets sats har **inte** ersatt kvittots tyst.
- [ ] Brutto är jämfört med kundens `beloppsgrans_flagga_sek`; flagga satt vid
      överskridande (`belopp_over_grans`).
- [ ] Kundens `konto_overrides` är kontrollerade innan default-kontot användes.
- [ ] Vid omvänd betalningsskyldighet: fakturan saknar moms, 2614 (kredit) och
      2647 (debet) speglar varandra, rutor 24/30/48 är satta.
- [ ] En eventuell rättelse är gjord som **ny verifikation med referens** till den
      rättade — ingen bokförd post har ändrats eller raderats (BFL 5 kap. 5 § och
      BFNAR 2013:2).
- [ ] Förslaget bär skill-version, lagrum och modell-id så att beslutet är
      rekonstruerbart.

## Källor

Primärkällor, kontrollerade 2026-07-08:

- Bokföringslag (1999:1078), 5 kap. 5–7 §§ och 7 kap. 2 § —
  <https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/bokforingslag-19991078_sfs-1999-1078/>
- BFNAR 2013:2 Bokföring (BFN:s vägledning; rättelse och förbud mot radering i
  datorbaserad bokföring) — <https://www.bfn.se/>
- Mervärdesskattelag (2023:200), 9 kap. och 16 kap. 13 § —
  <https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/mervardesskattelag-2023200_sfs-2023-200/>
- Prop. 2025/26:55, bet. 2025/26:SkU9 — tillfälligt sänkt mervärdesskatt på
  livsmedel 1 april 2026 – 31 december 2027 — <https://www.riksdagen.se/>
- Skatteförfarandelag (2011:1244), 26 kap. 10–11 §§ —
  <https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/skatteforfarandelag-20111244_sfs-2011-1244/>
- Aktiebolagslag (2005:551), 8 kap. 4 § och 29 § —
  <https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/aktiebolagslag-2005551_sfs-2005-551/>
- BAS-kontoplanen, officiella kontotabellen 2025 (BAS-intressenternas Förening) —
  <https://www.bas.se/>
- Skatteverket — omvänd betalningsskyldighet inom byggsektorn samt
  momsdeklarationens rutor — <https://www.skatteverket.se/>

## Verifieringsväg

Denna skill är **tier 2**: ett källciterat AI-utkast, verifierat mot
primärkällorna ovan men ännu inte granskat av en auktoriserad
redovisningskonsult. Den lyfts till **tier 1** när en namngiven auktoriserad
konsult har granskat innehållet — då uppdateras `verified_by` från `pending`
till granskarens namn och datum, och versionen bumpas. Tills dess gäller
disclaimern överst: allt är förslag, människan beslutar.
