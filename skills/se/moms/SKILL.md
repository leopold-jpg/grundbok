---
name: se-moms
description: >-
  Svensk moms (mervärdesskatt) i löpande bokföring: väljer momssats 25, 12
  eller 6 procent utifrån varu- eller tjänstekategori och affärshändelsens
  datum, inklusive den tillfälliga sänkningen för livsmedel till 6 procent
  1 april 2026 till 31 december 2027. Mappar sats till BAS-kontona 2611,
  2621, 2631 och 2641 samt hanterar omvänd betalningsskyldighet för
  byggtjänster med kontona 2614, 2647 och 4425 och deklarationsrutorna 24,
  30 och 48. Triggas av frågor som: vilken momssats gäller, moms på
  livsmedel, kontera ingående moms, byggfaktura utan moms, omvänd
  byggmoms, momsdeklaration månad kvartal eller helår.
jurisdiction: SE
category: moms
tax_year: 2026
tier: 2
verified_by: pending
version: 1.0.0
last_updated: 2026-07-08
depends_on: []
---

> **Tier 2 — källciterat AI-utkast.** Innehållet är skrivet utifrån och
> verifierat mot primärkällor (riksdagen.se, Skatteverket, bas.se) 2026-07-08,
> men har ännu inte granskats av auktoriserad redovisnings- eller
> skattekonsult. Allt som systemet producerar med stöd av denna skill är
> **förslag** som kräver mänskligt godkännande innan bokföring. Ansvaret för
> att bokföringen fullgörs enligt lag ligger alltid hos företagets styrelse
> och VD (ABL 2005:551 8 kap. 4 § respektive 29 §) och kan inte avtalas bort
> till konsult eller AI.

# se/moms — svenska momssatser, momskonton och omvänd betalningsskyldighet

`rules.json` i samma katalog är den maskinläsbara motsvarigheten till denna
fil och det som regelmotorn faktiskt exekverar. SKILL.md och rules.json får
aldrig glida isär: worked examples nedan körs som testfall mot motorn i CI,
och en ändring i den ena filen utan motsvarande ändring i den andra ska få
bygget att falla.

## Omfattning

**Täcker:**

- Val av momssats (25 / 12 / 6 %) per varu-/tjänstekategori, **avgränsat i
  tid** — satsen bestäms av affärshändelsens datum matchat mot
  giltighetsintervallen i `rules.json`, inte av registreringsdatumet.
- Mappning sats → BAS-momskonton (2611, 2621, 2631, 2641).
- Omvänd betalningsskyldighet för byggtjänster (ML 16 kap. 13 §):
  villkor, kontering (4425, 2614, 2647) och deklarationsrutor (24, 30, 48).
- Val av momsdeklarationsperiod (SFL 26 kap. 10–11 §§) — valideras mot
  kundconfigens `period`.

**Täcker inte** (eskaleras alltid till konsult, gissas aldrig):

- EU-handel, import/export, distansförsäljning (OSS/IOSS).
- Momsgrupper, vinstmarginalbeskattning, blandad verksamhet med
  proportionell avdragsrätt, jämkning av investeringsvaror.
- Undantagen från skatteplikt (vård, utbildning, finansiella tjänster m.m.).
- Kategorier som inte är modellerade i `rules.json` v1.0.0. ML:s reducerade
  satser omfattar fler kategorier än de modellerade — t.ex. reparationer av
  cyklar, skor och kläder (12 %) — och en omodellerad kategori ska leda till
  eskalering, inte till ett antagande.

Kostnads- och skuldkonteringen i övrigt (t.ex. 4010, 2440) ägs av skillen
`se/bas-kontering`; denna skill äger satsen och momskontona. Worked examples
nedan visar hela verifikatet för tydlighets skull.

## Regler

### 1. Momssatser per kategori (ML 2023:200 9 kap.)

Generell skattesats är 25 % (ML 9 kap. 2 §). Reducerade satser gäller för
särskilt uppräknade kategorier. Tabellen speglar `kategorier` i `rules.json`
exakt:

| Kategori (`rules.json`-nyckel) | Sats | Giltighet | Lagrum / källa |
|---|---|---|---|
| Generell skattesats (`standard`) | 25 % | tills vidare | ML (2023:200) 9 kap. 2 § |
| Livsmedel (`livsmedel`) | 12 % | t.o.m. 2026-03-31 | ML (2023:200) 9 kap. |
| Livsmedel (`livsmedel`) | **6 %** | **2026-04-01 – 2027-12-31** | Tillfällig sänkning, prop. 2025/26:55, bet. 2025/26:SkU9 |
| Livsmedel (`livsmedel`) | 12 % | fr.o.m. 2028-01-01 | Återgång till ordinarie sats, ML (2023:200) 9 kap. |
| Restaurang- och cateringtjänster (`restaurang_catering`) | 12 % | tills vidare | ML (2023:200) 9 kap. |
| Hotell- och rumsuthyrning, camping (`hotell`) | 12 % | tills vidare | ML (2023:200) 9 kap. |
| Böcker, tidningar, e-publikationer (`bocker_tidningar`) | 6 % | tills vidare | ML (2023:200) 9 kap. |
| Persontransporter (taxi, buss, tåg, inrikesflyg) (`persontransport`) | 6 % | tills vidare | ML (2023:200) 9 kap. |
| Kultur och idrott (entréer, utövande) (`kultur_idrott`) | 6 % | tills vidare | ML (2023:200) 9 kap. |

Kategorialias i `rules.json` (`kontorsmaterial`, `it_tjanster`, `byggtjanst`,
`ovrigt`) pekar på `standard` (25 %). Observera att `byggtjanst` bara ger
25 % när omvänd betalningsskyldighet **inte** är tillämplig — se regel 4.

### 2. Satsen styrs av affärshändelsens datum — inte bokföringsdatumet

Livsmedel är det levande beviset: satsen sänktes tillfälligt från 12 % till
6 % den 1 april 2026 och återgår till 12 % den 1 januari 2028
(prop. 2025/26:55, bet. 2025/26:SkU9). **Samma kvitto konteras alltså olika
beroende på när affärshändelsen inträffade:**

| Affärshändelsens datum | Kategori | Sats |
|---|---|---|
| 2026-03-15 | livsmedel | 12 % |
| 2026-07-08 | livsmedel | **6 %** |
| 2028-01-15 | livsmedel | 12 % |

Regelmotorn matchar affärshändelsens datum mot `from`/`to`-intervallen i
`rules.json`. Detta är skälet till att satserna är **datumavgränsade regler
i versionerad data** i stället för konstanter i en prompt: när riksdagen
ändrar en sats är ändringen en diffbar rad med lagrum, och äldre
verifikationer förblir förklarbara med den regelversion som gällde då.

### 3. Momskonton (officiella BAS 2025-tabellen, bas.se)

BAS-kontoplanen förvaltas av BAS-intressenternas Förening. Utgående moms
bokförs på satsspecifika konton; **ingående moms delas inte upp per sats** —
2641 gäller alla satser.

| Konto | Benämning (BAS 2025) | Användning |
|---|---|---|
| 2611 | Utgående moms 25 % | Utgående moms, generell sats |
| 2621 | Utgående moms 12 % | Utgående moms, 12 %-kategorierna |
| 2631 | Utgående moms 6 % | Utgående moms, 6 %-kategorierna |
| 2641 | Debiterad ingående moms | Ingående moms, **alla satser** |
| 2614 | Utgående moms omvänd betalningsskyldighet 25 % | Köparens utgående moms vid omvänd betalningsskyldighet |
| 2647 | Ingående moms omvänd betalningsskyldighet | Köparens ingående moms vid omvänd betalningsskyldighet |
| 4425 | Inköpta tjänster i Sverige, omvänd betalningsskyldighet, 25 % | Köparens kostnadskonto vid omvänd betalningsskyldighet |
| 3231 | Säljarens intäktskonto vid omvänd betalningsskyldighet inom byggsektorn | Säljaren fakturerar utan moms |

Varningar (verifierade mot officiella BAS 2025-tabellen):

- **2617 finns inte i officiella BAS** — det är en programvarukonvention i
  vissa system och ska inte föreslås.
- Kostnadskontot 4010 "Inköp material och varor" i exemplen nedan är
  Fortnox-/Visma-praxis; officiella BAS definierar 4000. Kontot ägs av
  `se/bas-kontering` och är konfigurerbart per kund.
- **BAS 2026 innehåller större ändringar i kontoklass 4.** Kontona här är
  verifierade mot BAS 2025; stäm av mot BAS 2026 före produktion.

### 4. Omvänd betalningsskyldighet för byggtjänster (ML 2023:200 16 kap. 13 §)

"Omvänd betalningsskyldighet" är lagens nuvarande term (tidigare "omvänd
skattskyldighet").

| Moment | Innehåll | Lagrum / källa |
|---|---|---|
| Tjänster som omfattas | Mark- och grundarbeten, bygg- och anläggningsarbeten, bygginstallationer, slutbehandling av byggnader, uthyrning av bygg- och anläggningsmaskiner med förare, byggstädning samt uthyrning av arbetskraft för dessa tjänster | ML (2023:200) 16 kap. 13 § |
| Köparvillkor | Köparen är en beskattningsbar person som i sin verksamhet inte endast tillfälligt tillhandahåller sådana tjänster, eller en mellanman som vidareförsäljer till en sådan köpare | ML (2023:200) 16 kap. 13 § |
| Fakturering | Säljaren fakturerar **utan moms**; säljarens intäktskonto är 3231 | ML (2023:200) 16 kap. 13 §; BAS 2025 |
| Köparens redovisning | Köparen redovisar **både utgående moms (2614) och ingående moms (2647)** på 25 % av fakturabeloppet; kostnadskontot är 4425 | ML (2023:200) 16 kap. 13 §; BAS 2025 |
| Deklarationsrutor | Ruta 24 (underlag), ruta 30 (utgående moms 25 %), ruta 48 (ingående moms) | Skatteverket, momsdeklarationen |
| Nettoeffekt | Noll vid full avdragsrätt — utgående och ingående moms tar ut varandra | — |

I demon aktiveras regeln av kundconfigens `omvand_bygg: true`
(se `config.schema.json`); satsvalet är inte konfigurerbart — det är lag.

### 5. Momsdeklarationsperiod (SFL 2011:1244 26 kap. 10–11 §§)

Kundconfigens `period` väljs mot dessa gränser. Beskattningsunderlaget är
inget systemet kan verifiera ur ett enskilt kvitto — att periodvalet är
förenligt med gränserna är konsultens ansvar vid onboarding. Tabellen
speglar `deklarationsperioder` i `rules.json`:

| Period (`rules.json`-värde) | Villkor | Lagrum |
|---|---|---|
| Månad (`manad`) | Huvudregel; obligatorisk över 40 mnkr beskattningsunderlag | SFL (2011:1244) 26 kap. 10–11 §§ |
| Kvartal (`kvartal`) | Beskattningsunderlag högst 40 mnkr | SFL (2011:1244) 26 kap. 10–11 §§ |
| Helår (`helar`) | Beskattningsunderlag högst 1 mnkr | SFL (2011:1244) 26 kap. 10–11 §§ |

## Worked examples

Exemplen körs som testfall mot regelmotorn i CI och ska ge exakt dessa
konteringsrader. Alla namn är påhittade. Belopp i kronor med två decimaler;
motorn räknar internt i ören som heltal.

### Exempel A — livsmedelsinköp efter satsändringen (6 %)

**Input:** Café Exempel AB tar emot en leverantörsfaktura från
Kafferosteriet Exempel AB: kaffebönor, 1 000,00 kr netto.
Affärshändelsens datum: **2026-07-08**.

**Resonemang:** Kategori `livsmedel`. Datumet 2026-07-08 ligger i
intervallet 2026-04-01 – 2027-12-31 → sats **6 %** (prop. 2025/26:55).
Ingående moms: 1 000,00 × 6 % = 60,00 kr. Ingående moms bokförs alltid på
2641 oavsett sats.

| Konto | Benämning | Debet | Kredit |
|---|---|---:|---:|
| 4010 | Inköp material och varor | 1 000,00 | |
| 2641 | Debiterad ingående moms | 60,00 | |
| 2440 | Leverantörsskulder | | 1 060,00 |

### Exempel B — samma kvitto, före satsändringen (12 %)

**Input:** Identisk faktura, men affärshändelsens datum är **2026-03-15**.

**Resonemang:** Kategori `livsmedel`. Datumet 2026-03-15 ligger före
2026-04-01 → sats **12 %** (ML 9 kap., ordinarie sats för livsmedel).
Ingående moms: 1 000,00 × 12 % = 120,00 kr.

| Konto | Benämning | Debet | Kredit |
|---|---|---:|---:|
| 4010 | Inköp material och varor | 1 000,00 | |
| 2641 | Debiterad ingående moms | 120,00 | |
| 2440 | Leverantörsskulder | | 1 120,00 |

**Detta är demopoängen:** samma kvitto, olika datum, olika sats — utan att
en enda rad kod ändrats. Satsen är versionerad data, inte prompttext.

### Exempel C — byggtjänst med omvänd betalningsskyldighet

**Input:** Byggbolaget Exempel AB (byggföretag, `omvand_bygg: true`) tar
emot en faktura från Underentreprenör Exempel AB: byggtjänst,
10 000,00 kr — **fakturerad utan moms** med hänvisning till omvänd
betalningsskyldighet.

**Resonemang:** Byggtjänst, köparen är ett byggföretag som inte endast
tillfälligt tillhandahåller byggtjänster → omvänd betalningsskyldighet
enligt ML 16 kap. 13 §. Köparen redovisar utgående moms 25 % av
10 000,00 = 2 500,00 kr (2614) och lyfter samma belopp som ingående moms
(2647). Kostnaden bokförs på 4425.

| Konto | Benämning | Debet | Kredit |
|---|---|---:|---:|
| 4425 | Inköpta tjänster i Sverige, omvänd betalningsskyldighet, 25 % | 10 000,00 | |
| 2440 | Leverantörsskulder | | 10 000,00 |
| 2614 | Utgående moms omvänd betalningsskyldighet 25 % | | 2 500,00 |
| 2647 | Ingående moms omvänd betalningsskyldighet | 2 500,00 | |

**Momsdeklaration:** ruta 24 (underlag) 10 000 kr, ruta 30 (utgående moms
25 %) 2 500 kr, ruta 48 (ingående moms) 2 500 kr. Nettoeffekten är noll vid
full avdragsrätt.

## Självkontroller

- [ ] Är momssatsen vald utifrån **affärshändelsens datum**, inte
      registrerings- eller bokföringsdatumet?
- [ ] Livsmedel: ligger datumet i intervallet 2026-04-01 – 2027-12-31
      (→ 6 %), före (→ 12 %) eller efter (→ 12 % fr.o.m. 2028-01-01)?
- [ ] Är utgående moms bokförd på satsspecifikt konto
      (2611 / 2621 / 2631) och ingående moms alltid på 2641?
- [ ] Föreslås ingenstans konto 2617? (Finns inte i officiella BAS.)
- [ ] Stämmer aritmetiken: netto × sats = moms, netto + moms = brutto,
      summa debet = summa kredit?
- [ ] Omvänd bygg: är fakturan utan moms, redovisar köparen **båda**
      sidorna (2614 kredit och 2647 debet), och fylls rutorna 24 / 30 / 48?
- [ ] Är kundens deklarationsperiod förenlig med gränserna i
      SFL 26 kap. 10–11 §§ (kvartal ≤ 40 mnkr, helår ≤ 1 mnkr)?
- [ ] Faller ärendet utanför omfattningen (EU-handel, momsgrupp,
      vinstmarginalbeskattning, blandad verksamhet, omodellerad kategori)?
      Eskalera till konsult i stället för att gissa.
- [ ] Matchar exemplen i denna fil `rules.json` version 1.0.0?
      (CI kör dem som testfall — en avvikelse ska fälla bygget.)

## Källor

Samtliga sakuppgifter verifierade mot primärkällor 2026-07-08.

- Mervärdesskattelag (2023:200), riksdagen.se:
  <https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/mervardesskattelag-2023200_sfs-2023-200/>
- Skatteförfarandelag (2011:1244), riksdagen.se:
  <https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/skatteforfarandelag-20111244_sfs-2011-1244/>
- Prop. 2025/26:55 (tillfälligt sänkt mervärdesskatt på livsmedel) och
  bet. 2025/26:SkU9 — sökbara på riksdagen.se:
  <https://www.riksdagen.se/sv/sok/?q=2025%2F26%3A55>
- Skatteverket — moms för företag (satser, deklarationsrutor, omvänd
  betalningsskyldighet inom byggsektorn):
  <https://www.skatteverket.se/foretag/moms.html>
- BAS-intressenternas Förening — officiella BAS-kontotabellen (2025):
  <https://www.bas.se/>

---

**Verifieringsväg:** Denna skill är `tier: 2` — ett källciterat AI-utkast,
verifierat mot primärkällorna ovan men ännu inte fackgranskat. Den lyfts
till `tier: 1` när en **namngiven auktoriserad konsult** har granskat
innehållet; då uppdateras `verified_by` med namn och granskningsdatum, och
versionen bumpas i både SKILL.md och `rules.json`.
