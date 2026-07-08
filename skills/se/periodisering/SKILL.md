---
name: se-periodisering
description: >-
  Periodisering av kostnader och intäkter enligt K2 för svenska företag: när en post ska
  hänföras till rätt räkenskapsår, väsentlighetsgränsen 5 000 kr (BFNAR 2016:10 punkt 2.4),
  förutbetalda kostnader på konto 1790, upplupna kostnader på konto 2990 samt linjär
  upplösning över täckningsperioden. Triggas när underlag innehåller fraser som "hyra för
  nästa kvartal", "förskottsbetalning", "avser perioden", "faktureras i efterskott",
  "förutbetald kostnad", "upplupen kostnad" eller "interimspost" — eller när fakturans
  täckningsperiod och affärshändelsens datum ligger i olika räkenskapsår.
jurisdiction: SE
category: redovisning
tax_year: 2026
tier: 2
verified_by: pending
version: 0.1.0
last_updated: 2026-07-08
depends_on:
  - se-bas-kontering
---

# se/periodisering — Periodisering av kostnader och intäkter

> **Tier 2 — källciterat AI-utkast.** Innehållet är skrivet utifrån och verifierat mot
> primärkällor (bfn.se, riksdagen.se, bas.se) 2026-07-08, men har ännu **inte** granskats av
> auktoriserad redovisningskonsult. Allt systemet producerar med stöd av denna skill är
> **förslag** som kräver mänskligt godkännande innan något bokförs. Ansvaret för att
> bokföringen fullgörs enligt lag ligger alltid ytterst hos företagets styrelse och VD
> (ABL 2005:551 8 kap. 4 § respektive 29 §; BFL 1999:1078 2 kap.) och kan inte överlåtas
> till konsult eller AI — straffrättsligt ytterst BrB 11 kap. 5 § (bokföringsbrott).

## Omfattning

**Skillen täcker:**

- När en kostnad eller intäkt ska hänföras till ett annat räkenskapsår än det då den
  betalas/faktureras (periodiseringsprincipen).
- Väsentlighetsgränsen i K2: poster under 5 000 kr behöver inte periodiseras.
- Kontering av förutbetalda kostnader (konto 1790) och upplupna kostnader (konto 2990).
- Linjär upplösning av periodiserade poster över täckningsperioden.

**Skillen täcker inte:** K3-regelverket, pågående arbeten, varulager, avskrivningar,
semesterlöneskuld eller momsperiodisering (moms hanteras av `se/moms`). Intäktssidan följer
samma princip men är inte implementerad i `rules.json` v0.1.0 — den tillkommer som nya
regelrader i datafilen, inte som ny kod.

**Ärlig demonot:** denna skill körs *inte* i den vertikala skivans huvudflöde ikväll. Den
finns i biblioteket för att visa mönstret: en tredje, femte eller sjunde skill är tre filer
(`SKILL.md` + `rules.json` + `config.schema.json`) — inte ett nytt kodprojekt.

## Regler

`rules.json` (v0.1.0) i samma katalog är den maskinläsbara motsvarigheten som regelmotorn
exekverar — regel-id:n i tabellen nedan matchar id:n där, och worked examples i denna fil
körs som testfall mot motorn i CI så att SKILL.md och rules.json aldrig kan glida isär.
Kundparametern `periodiseringsgrans_sek` (default 5 000, se `config.schema.json`) styr
regel 2.

| # | id i rules.json | Regel | Lagrum / källa |
|---|---|---|---|
| 1 | — | Periodiseringsprincipen: intäkter och kostnader som är hänförliga till räkenskapsåret ska tas med oavsett tidpunkten för betalningen. | ÅRL (1995:1554) 2 kap. 4 § första stycket 4 |
| 2 | `vasentlighetsgrans` | Ett företag som tillämpar K2 behöver inte periodisera inkomster och utgifter som **var för sig understiger 5 000 kr**. Motorn läser gränsen ur kundparametern `periodiseringsgrans_sek` (default 5 000). | BFNAR 2016:10 (K2) punkt 2.4 — ordalydelsen verifierad mot BFN:s grundförfattning 2026-07-08 |
| 3 | `forutbetald_kostnad` | Utgift som bokförs/betalas i år men avser kommande räkenskapsår tas upp som tillgång på **1790 Övriga förutbetalda kostnader och upplupna intäkter**. | BAS-kontoplanen (BAS-intressenternas Förening); ÅRL 2 kap. 4 § första stycket 4 |
| 4 | `upplupen_kostnad` | Kostnad som hör till innevarande räkenskapsår men faktureras senare reserveras som skuld på **2990 Övriga upplupna kostnader och förutbetalda intäkter**. | BAS-kontoplanen; ÅRL 2 kap. 4 § första stycket 4 |
| 5 | `forutbetald_kostnad` | Periodiserat belopp löses upp **linjärt** över täckningsperioden (lika delar per månad); upplösningsposterna ska summera exakt till ursprungsbeloppet. | rules.json `forutbetald_kostnad`; god redovisningssed |
| 6 | — | Varje periodiserings- och upplösningspost är en egen verifikation med hänvisning till underlaget (ursprungsfakturan): när den sammanställts, när affärshändelsen inträffat, vad den avser, belopp, motpart, verifikationsnummer. | BFL (1999:1078) 5 kap. 6–7 §§ |
| 7 | — | Rättelse av en felaktig periodiseringspost sker genom särskild rättelsepost som anger när och av vem rättelsen gjorts — bokförda poster raderas aldrig i datorbaserad bokföring. | BFL 5 kap. 5 § + BFNAR 2013:2 (BFN) |

**Varning vid regel 2:** gränsen får inte kringgås genom uppdelad fakturering, och många
likartade poster som var för sig understiger 5 000 kr kan tillsammans utgöra ett väsentligt
belopp — då ska de periodiseras ändå (väsentlighetsprincipen i ÅRL; jfr branschuttalandet
Srf U 1).

## Worked examples

### Hyresfaktura för Q1 2027 betald i december 2026

**Input.** Kafferosteriet Exempel AB (K2, kalenderår som räkenskapsår) betalar 2026-12-15
en hyresfaktura på **12 000,00 kr** avseende lokalhyra för perioden januari–mars 2027.
Hyran faktureras utan moms i exemplet (momshantering ligger i `se/moms` och berörs inte
här). Kundparameter `periodiseringsgrans_sek` = 5 000 (default).

**Resonemang.**

1. Beloppet 12 000 kr överstiger 5 000 kr → undantaget i BFNAR 2016:10 punkt 2.4 är inte
   tillämpligt; posten **ska periodiseras** (regel 1–2).
2. Hela kostnaden avser räkenskapsåret 2027 → förutbetald kostnad, konto 1790 (regel 3).
3. Täckningsperioden är 3 månader → linjär upplösning 12 000 / 3 = **4 000,00 kr per månad**
   januari–mars 2027 (regel 5).

**Verifikation 1 — betalning 2026-12-15:**

| Konto | Benämning | Debet | Kredit |
|---|---|---:|---:|
| 1790 | Övriga förutbetalda kostnader och upplupna intäkter | 12 000,00 | |
| 1930 | Företagskonto | | 12 000,00 |

**Verifikation 2–4 — månatlig upplösning per 2027-01-31, 2027-02-28 och 2027-03-31, vardera:**

| Konto | Benämning | Debet | Kredit |
|---|---|---:|---:|
| 5010 | Lokalhyra | 4 000,00 | |
| 1790 | Övriga förutbetalda kostnader och upplupna intäkter | | 4 000,00 |

Efter 2027-03-31 är saldot på 1790 noll för denna post. Hela kostnaden om 12 000,00 kr
belastar 2027 — ingenting belastar 2026, trots att betalningen skedde då. Det är exakt vad
ÅRL 2 kap. 4 § första stycket 4 kräver.

**Variant under gränsen:** samma faktura men på 4 800,00 kr understiger 5 000 kr → behöver
inte periodiseras (BFNAR 2016:10 punkt 2.4) utan får kostnadsföras direkt i december 2026:
5010 D 4 800,00 / 1930 K 4 800,00.

## Självkontroller

- [ ] Överstiger posten periodiseringsgränsen (`periodiseringsgrans_sek`, default 5 000 kr,
      BFNAR 2016:10 punkt 2.4)? Om inte: kostnadsför direkt och dokumentera bedömningen.
- [ ] Avser posten helt eller delvis ett annat räkenskapsår än det då den betalas/faktureras?
- [ ] Framgår täckningsperioden av underlaget, och har varje periodiseringsverifikation
      hänvisning till underlaget (BFL 5 kap. 7 §)?
- [ ] Summerar de linjära upplösningsposterna exakt till ursprungsbeloppet (lägg eventuell
      öresdifferens på sista perioden)?
- [ ] Är 1790 och 2990 avstämda mot specifikation vid periodens utgång (saldo = summan av
      öppna poster)?
- [ ] Debet = kredit i varje verifikation (regelmotorn hårdstoppar annars).
- [ ] Finns många likartade småposter under gränsen som tillsammans är väsentliga? Då ska de
      periodiseras trots punkt 2.4.

## Källor

- BFNAR 2016:10 *Årsredovisning i mindre företag (K2)*, grundförfattning (BFN):
  <https://bfn.se/wp-content/uploads/2020/06/bfnar16-10-grund.pdf> — punkt 2.4 verifierad
  ordagrant 2026-07-08.
- BFN:s vägledning K2, konsoliderad version:
  <https://www.bfn.se/wp-content/uploads/vl16-10-k2ar-kons2025.pdf>
- Årsredovisningslag (1995:1554):
  <https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/arsredovisningslag-19951554_sfs-1995-1554/>
- Bokföringslag (1999:1078):
  <https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/bokforingslag-19991078_sfs-1999-1078/>
- BFNAR 2013:2 *Bokföring* (BFN): <https://www.bfn.se/> (rättelse i datorbaserad bokföring)
- BAS-kontoplanen (BAS-intressenternas Förening): <https://www.bas.se/>
- Srf U 1 *Tillämpning av femtusenkronorsregeln* (sekundärkälla, branschuttalande):
  <https://srfredovisning.se/srfu-srfs-uttalanden-i-redovisningsfragor/srfu-1-tillampning-av-femtusenkronorsregeln-i-k2/>

---

*Verifieringsväg: denna skill är `tier: 2` (`verified_by: pending`) — ett källciterat utkast
verifierat mot primärkällor. Den lyfts till `tier: 1` först när en namngiven auktoriserad
redovisningskonsult har granskat innehållet och antecknats i `verified_by`.*
