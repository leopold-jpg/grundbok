# Testunderlag — verkliga fall för golden-tester

Källa: verkliga fakturaflöden ur Otiva/Sibbjäns-mailen, juni–juli 2026.
Syfte: när mallarnas promptinnehåll skrivs ska varje mall klara dessa
fall. PDF:erna laddas ner ur respektive mailtråd till
`testdata/underlag/` (namngivning nedan). Beloppen och orgnr i
underlagen är verkliga — testdata-mappen ska vara gitignorerad,
endast förväntningsfilerna (JSON) committas.

## Fall 1 — Fel tenant (Eleiko F172806)
Faktura ställd på fel bolag (Otiva, skulle till Sibbjans Arrende).
Gick till påminnelse innan felet fångades manuellt.
- Fil: `eleiko-F172806.pdf`
- Mall: alla bokföringsmallar
- Förväntat: INGEN bokföring. Proposal med action `flag_wrong_tenant`,
  konfidens på flaggan hög, motivering: fakturamottagare matchar
  inte tenantens bolagsuppgifter.
- Lärdom: mottagarkontroll är steg 1 i varje mall, före kontering.

## Fall 2 — ÄTA / tilläggsbeställning (Enviment 1043)
Faktura utanför känt kontraktsvärde; ekonomifunktionen kände inte
igen den. Visade sig vara ÄTA som blivit tilläggsbeställning.
- Fil: `enviment-1043.pdf`
- Mall: bokforing-bygg
- Förväntat: Proposal med kontering MEN status `needs_review`,
  motivering: avviker från känt ordervärde/leverantörshistorik.
  Aldrig auto-bokning på avvikelse mot kontrakt.

## Fall 3 — Förskottsbetalning (Sandbergs, tankvagn)
Förskott inför inköp av tankvagn, attesterad utan förståelse.
- Fil: `sandbergs-forskott.pdf`
- Mall: bokforing-bygg (generaliserbar)
- Förväntat: kontering som förskott till leverantör (1480), INTE
  kostnad. Konfidens medel → granskningskö första gången mönstret
  ses hos tenanten.

## Fall 4 — Privat utlägg, ej bolag (BudExperten 1220)
Frakt av privat Sonos-produkt, fakturerad till bolagsmailen.
- Fil: `budexperten-1220.pdf`
- Mall: alla
- Förväntat: `flag_private_expense` — ingen bokföring, notis till
  granskaren. Signaler: leveransbeskrivning utan koppling till
  verksamheten, mottagare privatperson.

## Fall 5 — Kvitto-/transaktionsmatchning (Loopia 37,50 + 323,75)
Två fakturor dragna som EN kortsumma; ett kvitto saknades.
- Filer: `loopia-323_75.pdf` (+ det saknade på 37,50 när det finns)
- Mall: bokforing-konsult (kortköp/abonnemang)
- Förväntat: matchning underlag↔transaktion är inte 1:1.
  Delmatchning → Proposal för den styrkta delen + `missing_receipt`-
  flagga för residualen med belopp.

## Fall 6 — Momsundantag / omvänd skattskyldighet (Adobe)
EU-köp med VAT-nr, skatteundantagen transaktion.
- Fil: `adobe-skatteundantagen.pdf`
- Mall: bokforing-konsult
- Förväntat: omvänd skattskyldighet konteras korrekt (utgående +
  ingående moms på förvärv, 2614/2645), hög konfidens — detta är
  ett mönster som SKA auto-bokas.

## Fall 7 — Återkommande drift med trendavvikelse (elfakturor Sibbjäns)
Elkostnad "högst hittills", ledningen begärde analys.
- Filer: `el-sibbjans-2026-*.pdf` (hela årets serie ur tråden)
- Mall: bokforing-restaurang/drift
- Förväntat: kontering hög konfidens (känd leverantör, känt konto)
  MEN telemetrisignal `anomaly_amount` när beloppet avviker kraftigt
  från tenantens historik — bokför + notifiera, blockera inte.

## Fall 8 — Refakturering mellan koncernbolag (Länna Sport 102640→102647)
Faktura begärd omställd från Otiva till Sibbjans Arrende; ny
faktura utfärdad, gammal makuleras.
- Filer: `lanna-102640.pdf`, `lanna-102647.pdf`
- Mall: alla
- Förväntat: 102640 flaggas (fall 1-logik); när 102647 anländer ska
  agenten koppla den till samma underliggande köp och INTE skapa
  dubbel kostnad. Dubblettdetektering på leverantör+belopp+period.

## Format för förväntningsfiler

Per fall: `testdata/expected/<fall>.json` med Proposal-formen från
kontraktet (v0.3, inkl mallId + mallVersion) alternativt förväntad
flagga. Golden-testet kör underlaget genom mallen (mockad LLM i
detta skede, riktig i nästa) och diffar mot förväntningen.

## Att göra (Leopold, manuellt)
- [ ] Ladda ner PDF:erna ur trådarna ovan till testdata/underlag/
- [ ] Lägg `testdata/underlag/` i .gitignore INNAN första committen
- [ ] Komplettera med 2–3 restaurangunderlag när de finns (saknas
      i mailen — Otiva/Sibbjäns är bygg/drift/konsult-tunga)
