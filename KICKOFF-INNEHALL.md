# Kickoff — innehållspasset + underlagsjakten (WP30–WP34)

Nattpass. Utgå från main (git pull först). Flat Next.js-app,
en commit per WP, npm test grönt mellan varje, adversariell
granskning innan PR, PR öppnas — MERGAS INTE.

Kontext: mallregistret (src/mallar/registry.ts) har fyra
funktionsroller med stub-promptar och två branschpaket (bygg,
restaurang) som är runtime-inerta. TESTUNDERLAG-GOLDEN.md i
docs/ eller repo-roten beskriver åtta verkliga fall.
testdata/underlag/ är gitignorerad och kan vara TOM i natt —
golden-testerna byggs mot textrepresentationer av underlagen,
PDF:er kopplas in senare.

## WP30 — riktiga systempromptar per roll

Skriv fullständiga systempromptar för bokforing, lon,
skatt-compliance, leverantorsreskontra. Krav per prompt:
- Rollens uppgift, gränser och eskaleringsregler (när ska
  förslaget till granskningskö i stället för auto)
- Obligatorisk mottagarkontroll FÖRST: matchar underlagets
  mottagare inte tenantens bolagsuppgifter → flag_wrong_tenant,
  ingen kontering (fall 1 i testunderlaget)
- Privat/verksamhetsfrämmande → flag_private_expense (fall 4)
- Underlag↔transaktion är inte 1:1: delmatchning + 
  missing_receipt-flagga med restbelopp (fall 5)
- Dubblettdetektering leverantör+belopp+period (fall 8)
- Förskott ≠ kostnad: kontera 1480 vid förskottsmönster (fall 3)
- Output ALLTID som giltig Proposal enligt kontraktet v0.3
Promptarna versioneras i registret (bumpa mallversion minor).

## WP31 — branschpaketen in i LLM-vägen

Gör paketen runtime-aktiva: när ett jobb körs för en tenant
ska aktiva branschpakets regler vävas in i systemprompten
(effektivaRegler finns redan). Bygg-paketet: omvänd byggmoms
(2617/2647-logik), ROT-hantering, ÄTA-vaksamhet (avvikelse mot
känt ordervärde → needs_review, fall 2). Restaurang-paketet:
livsmedelsmoms — OBS lagändring: matmoms sänks 12 % → 6 %
1 april 2026 t.o.m. 31 dec 2027; regeln ska vara datumstyrd,
inte hårdkodad sats. Kassarapportlogik som stub.
Test: samma underlag med/utan paket ger olika promptinnehåll.

## WP32 — de åtta fallen som golden-tester

Implementera fall 1–8 ur TESTUNDERLAG-GOLDEN.md som golden-
tester med textrepresentationer (fakturatext med belopp,
mottagare, radinnehåll enligt beskrivningarna). LLM-mockas
deterministiskt som idag, MEN: strukturera testerna så att
samma svit kan köras mot riktig LLM senare (flagga/env).
Förväntningsfiler i testdata/expected/<fall>.json (dessa
committas — de innehåller förväntad Proposal-form, inga
verkliga persondata). Fall 7 (elkostnad-anomali): telemetri-
signal anomaly_amount när belopp avviker >2x median för
leverantör+tenant — bokför men notifiera.

## WP33 — underlagsjakten (kompletteringskön)

Störst konsultvärde. Bygg:
1. Tabell kompletteringar: tenant_id, agent_id, proposal_id,
   typ (missing_receipt/fraga), belopp, beskrivning, status
   (open/paminnd/klar), skapad, senast_paminnd. RLS som övriga.
2. Flaggade Proposals (missing_receipt) skapar automatiskt en
   kompletteringsrad.
3. Byråvyn /byra: sektion "Väntar på kunden" — lista per
   klient med belopp och ålder, knapp "Påminn" som genererar
   ett färdigt vänligt mejlutkast (mailto: räcker i natt,
   mejladaptern kommer i intag-passet).
4. "Fråga kunden"-knapp i attestkön: konsulten skriver en
   fråga på ett förslag → kompletteringsrad typ 'fraga' →
   när svar registreras (fritextfält i byråvyn i natt) fästs
   det vid förslaget som kommentar i beslutsloggen (Rex-
   dokumentation).
5. Månadsgrönt v0: per klient+månad, grön när attestkö tom
   och kompletteringskö tom — chip i byråvyns klientlista.

## WP34 — smoke + rapport

- E2E: underlag med saknat kvitto → Proposal delmatchad →
  kompletteringsrad skapas → konsult ställer fråga → svar
  loggas → månadschip går från gul till grön när kön töms.
- Kör hela golden-sviten, npm test grönt.
- Adversariell granskning av hela diffen; åtgärda äkta fynd.
- Skriv docs/SESSIONSRAPPORT-innehall.md: per WP, avvikelser,
  granskningsfynd, vad som återstår (PDF-verifiering av golden,
  mejladaptern, intag-passet). Committa på branchen, öppna PR,
  skriv ut rapporten i chatten.

Blockeras du (otydligt kontrakt, rött test du inte förstår):
stanna, dokumentera, gissa aldrig vidare.
