# Datakällor & API-integrationer — att inte glömma

**Datum:** 2026-07-19, sen kväll
**Status:** idé/plan — byggs POST-DEPLOY (kräver avtal/nycklar)
**Princip:** varje extern kontroll = ny OBSERVATION i gransknings-
motorn (LLM observerar, motorn beslutar — samma mönster som idag).
API nere → observation saknas → försiktigare beslut, aldrig krasch.

## Prioriterad lista

### 1. VIES — EU:s momsregister (GRATIS, börja här)
- Verifierar VAT-nummer på riktigt innan omvänd skattskyldighet
  auto-bokas (fall 6 / Adobe-vägen)
- Ny observation: vat_giltig
- Inget avtal krävs — öppet SOAP/REST-API

### 2. Bolagsverket företagsinformation (avgift/avtal — kolla)
- Mottagarkontrollen (fall 1) uppgraderas: slå upp motpartens
  orgnr live — existens, korrekt namn, konkurs/likvidation
- Faktura från bolag i likvidation → röd flagga
- GULDKORNET: SNI-kod ur registret → branschpaket aktiveras
  AUTOMATISKT vid onboarding (byggfirma → bygg-paketet på,
  noll manuella val). Ger ADR-0005:s "bransch härleds ur
  tenanten" en riktig datakälla.
- Nya observationer: motpart_verifierad, motpart_status,
  tenant_sni

### 3. Skatteverket (verifiera vad som finns som öppet API)
- F-skattekontroll på leverantörer → reskontra-rollens
  vakthund (betalning till leverantör utan F-skatt = risk
  för skyldighet att dra skatt → flagga)
- Belopps-PDF/öppna data → kunskapsbankens AUTOMATISKA
  årsuppdatering (i stället för manuell insamling)
- Ny observation: f_skatt_ok

### 4. Peppol — e-faktura (senare, strategiskt)
- Intag v2: e-fakturor kommer strukturerade — ingen OCR,
  bara validering
- Obligatorisk e-faktura på väg i EU → accesspunkt blir
  biljett, inte feature

### 5. Bolagsverket inlämning iXBRL (när roll 5 byggs)
- Maskinväg för obligatorisk digital årsredovisning
  (räkenskapsår efter 2025-12-31, inlämningar fr. 2027)
- Hör till bokslutsrollen — roadmap

## Research som återstår (före bygge)

- [ ] Bolagsverkets API-villkor: pris, avtal, nycklar
- [ ] Exakt vilka Skatteverket-kontroller som finns som API
      (kontra manuell e-tjänst)
- [ ] Peppol-accesspunkt: egen vs via operatör

## Kom ihåg

- Gratis-först-ordning: VIES → SNI → resten
- SNI-onboardingen kan smygas in i intag-uppföljningen
- Allt annat: eget pass efter deploy
- Kunskapsbanken (docs/KUNSKAPSBANK-HJARNAN.md) är systerdok —
  API:erna gör dess innehåll till färskvara
