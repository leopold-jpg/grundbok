# Kunskapsbank för hjärnan — verifierade regler 2026 (v2)

**Insamlat:** 2026-07-19 (v2 samma kväll), webbverifierat mot
Skatteverket (inkl. deras officiella belopps-PDF för 2026), FAR,
Björn Lundén, Riksdagsbeslut. Syfte: råvara till branschpaket,
compliance-klockan och golden-tester. Regler är data: varje
aktiverad regel bär { källa, verifierad, gällerFrån, gällerTom }.

## Källkritik-lärdom från insamlingen

Två aggregatorsajter angav fel milersättning (18,50 i st.f. 25)
och sinsemellan motstridiga traktamentsreduceringar. REGEL:
beloppsregler i hjärnan får endast källas mot Skatteverket/
riksdagsbeslut; sekundärkällor används för förklaring, aldrig
för siffror. Skatteverkets belopps-PDF för inkomståret är
kanonisk källa och bör importeras som tabell vid årsskiften.

## Basbelopp och gränser 2026

- Prisbasbelopp 59 200 kr (förhöjt 60 500) · inkomstbasbelopp
  83 400 kr (2025: 80 600 — OBS 3:12 räknar på föregående års)
- Inventarier av mindre värde: 29 600 kr · kassaregistergräns:
  236 900 kr · bolagsskatt 20,6 %

## Roll: lon — utökad

**Arbetsgivaravgifter:** 31,42 % ordinarie. Ungdomsnedsättning
20,81 % (18–<23 vid årets ingång, lönedel ≤ 25 000 kr/mån,
2026-04-01–2027-09-30, över tak full avgift). Äldre-gräns
66 → 67 år. Växa-stöd 10,21 % ≤ 35 000 kr, första+andra
anställd, 24 mån.

**Milersättning:** 25 / 12 / 9,50 kr per mil (egen / förmåns /
el-förmåns). Överskjutande = lön. Laddel på jobbet permanent
skattefri 2026.

**Traktamente inrikes 2026 (Skatteverkets PDF):**
- Hel dag 300 kr · halv dag 150 kr · efter 3 mån 210 kr ·
  efter 2 år 150 kr · nattraktamente 150 kr (endast om
  arbetsgivaren inte betalat logi)
- Kräver ÖVERNATTNING + >50 km från bostad och tjänsteställe.
  Endagstraktamente = vanlig lön (AGI + skatt) — vanligt fel.
- Måltidsreducering (helt traktamente): alla tre måltider
  −270 kr · lunch+middag −210 kr · lunch eller middag −105 kr
  (frukost enskilt ~−45–60 kr — importera Skatteverkets exakta
  tabell, sekundärkällor spretar här)
- Hotellfrukost som ingår i rumspriset: traktamentet reduceras
  OCH kostförmån kan uppstå. Måltid i färdbiljett (flyg/tåg):
  ingen reducering, ingen förmån.
- Nytt allmänt råd SKV A 2025:5 fr. beskattningsår 2026:
  semester/sjukdom < 4 veckor FÖRLÄNGER tremånadersperioden
  (avbryter inte) — tidsstyrd regeländring.
- Utrikes: normalbelopp per land, fastställs årligen —
  importeras som tabell, hårdkodas aldrig.

**Kostförmån 2026 (Skatteverkets PDF):** frukost 62 kr ·
lunch/middag 124 kr · helt fri kost 310 kr per dag.

**Skattefria gåvor (inkl. moms):** julgåva 600 · jubileum
1 800 · minnesgåva 15 000. Över gräns → HELA beloppet förmån.

**Friskvårdsbidrag:** max 5 000 kr/år för skattefrihet
(etablerad praxis — verifiera beloppet mot Skatteverket vid
aktivering, ej kontrollerat i natt).

## Branschpaket: bygg — utökad

- ROT 2026: 30 % av arbetskostnaden (2025 tillfälligt 50 % —
  BETALDATUM styr vilken procent), max 50 000 kr/person/år,
  gemensamt ROT+RUT-tak 75 000 kr. Endast arbetskostnad;
  faktura utan arbete/material-uppdelning → needs_review.
  Utförarens ansökan senast 31 jan året efter.
- Omvänd byggmoms: befintlig regel; "omvänd betalnings-
  skyldighet" (svensk) vs "reverse charge" (EU) — detekteras
  separat (fall 6-vägen).
- Traktamenten i byggbranschen har egen SKV-broschyr (SKV 353)
  — kandidat till paketets fördjupning vid pilot med byggkund.

## Branschpaket: restaurang — utökad

- Matmoms 12 → 6 % 2026-04-01–2027-12-31 (datumstyrd ✓).
  Alkohol alltid 25 %. Blandat kvitto = delad moms.
- Kassaregister > 236 900 kr · personalliggare obligatorisk.
- Ungdomsnedsättningen träffar branschen hårt (många unga
  anställda) — lönerollen + restaurangpaketet samverkar här.
- Representation: momslyft på underlag ≤ 300 kr/person,
  enklare förtäring ~60 kr — VERIFIERA exakta belopp innan
  aktivering (stabil regel, beloppskälla ej kontrollerad).

## Roll: skatt-compliance — utökad

**3:12-REFORMEN (beslutad 2025-11-27, gäller fr. 2026-01-01):**
Förenklings- och huvudregeln ihopslagna till EN regel:
- Grundbelopp 4 IBB (föregående års: 4 × 80 600 = 322 400 kr
  för beskattningsår 2026), fördelas per ägarandel; max ETT
  grundbelopp per person över alla fåmansbolag
- Lönebaserat utrymme: 50 % av delägarens andel av löne-
  underlaget över 8 IBB (644 800 kr)
- Omkostnadsbelopp: endast del > 100 000 kr räknas
- Räntan på sparat utdelningsutrymme SLOPAD · karens 5 → 4 år
- AGENTGRÄNS: skatt-compliance-rollen ska KÄNNA IGEN
  K10/utdelningsfrågor och eskalera till människa — aldrig
  rådge om uttagsstrategi (notatets rådgivningsgräns gäller).

**Deadlines:** AGI 12:e (17:e jan/aug) · moms normalt 12:e ·
förseningsavgifter 625/1 250 (skattedekl.), 6 250 (inkomstdekl.
AB), 7 500+ (årsredovisning) · digital årsredovisning iXBRL
obligatorisk räkenskapsår som börjar efter 2025-12-31.

## Roll: bokforing — periodisering (stabil kunskap, K2)

- 5 000 kr-regeln: poster under 5 000 kr behöver inte
  periodiseras (BFNAR 2016:10) — förklarar varför småfakturor
  kostnadsförs direkt. Verifiera formulering vid aktivering.
- Återkommande utgifter som varierar < 20 % mellan år får
  kostnadsföras löpande (K2-förenkling) — samma förbehåll.

## Golden-testkandidater (fall 9–18)

1. LÖN 21-åring, 28 000 kr, maj 2026 → 20,81 % på 25 000 +
   31,42 % på 3 000
2. LÖN född 2003, 24 000 kr, maj 2026 → full avgift
3. LÖN julgåva 750 kr → hela beloppet förmån
4. BYGG ROT-faktura betald 2026-02 med 50 % → flagga
5. BYGG ROT utan arbete/material-split → needs_review
6. RESTAURANG kvitto mat+vin efter 2026-04-01 → 6 % + 25 %
7. ALLA milersättning 30 kr/mil → 25 skattefri + 5 lön
8. LÖN endagstraktamente utbetalt skattefritt → flagga (= lön)
9. LÖN tjänsteresa 2 dgr, hotellfrukost ingår → reducerat
   traktamente + kostförmånskontroll
10. SKATT underlag/fråga som rör utdelning/K10 → eskalera
    till människa, aldrig auto

## Inmatning (nästa innehållspass)

1. Regler in som data med käll- och datumfält; Skatteverkets
   belopps-PDF importeras som kanonisk tabell
2. Golden 9–18 implementeras i sviten (mönster fall 1–8)
3. Compliance-klockan seedas ur deadline-sektionen
4. Ovaliderade poster (friskvård, representation, K2-
   formuleringar, frukostreducering exakt) verifieras mot
   primärkälla INNAN aktivering — de är markerade ovan
