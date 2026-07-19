# Produktnotat — Förhörschatt i detaljpanelen

**Datum:** 2026-07-19
**Status:** idé, väntar på Mats reaktion vid demo (~25 juli)
**Ägare:** Leopold

## Idén i en mening

En kontextbunden frågeyta i attestpanelens detaljvy där konsulten
kan förhöra agenten om det aktuella förslaget — aldrig en fritt
svävande chatbot.

## Varför

Konsultens naturliga fråga vid ett oväntat förslag är "varför?".
I dag är svaret dolt i agentens motiveringsfält och Langfuse-
traces (som konsulten aldrig ska behöva öppna). En frågeyta i
panelen gör resonemanget förhörbart där beslutet fattas.

## Rätt version (bygg denna)

Konsulten står på ett förslag och frågar OM DET:
- "varför 4010 och inte 5460?"
- "hur hanterades förra fakturan från denna leverantör?"
- "vad säger omvänd byggmoms här?"

Agenten svarar med det den redan har:
1. Sitt eget resonemang (motivering + flaggor från förslaget)
2. Klientens historik (konteringsminne, tidigare verifikat)
3. Aktiva branschpaketsregler (med regel-id som källa)

Varje svar pekar på sin källa. Det är förhör av handläggaren
som skrev lappen — inte en generell AI-assistent.

## Fel version (bygg aldrig)

Fritt svävande chattbubbla, "fråga vad som helst". Urholkar
förtroendet (svar utan underlag), öppnar rådgivningsansvar,
och konkurrerar med attestflödet i stället för att stödja det.

## Säkerhetsramar (gratis ur befintlig arkitektur)

1. **RLS-scopad**: svar kan bara bygga på tenantens egen data —
   agenten kan inte råka citera annan klients siffror.
2. **Loggad**: fråga + svar fästs vid förslaget i beslutsloggen,
   samma mönster som "Fråga kunden"-kedjan → Rex-dokumentation.
3. **Läsande, aldrig skrivande**: chatten kan förklara men inte
   ändra. All handling går via attest/avvisa som vanligt.
   Proposal-kontraktet förblir enda dörren in.

## Befintligt fundament

- Rådgivningschatt-stub finns redan i intag-planens scope och
  syns i Langfuse-tracen (guardrail → tool → retriever →
  generation → beslutsport).
- Fråga/svar-kedjan mot KUND är byggd (WP33) — samma
  persistensmönster återanvänds för fråga/svar mot AGENT.
- Konteringsminne + branschpaket ger retrievern sitt innehåll.

## Timing

- INTE eget pass nu. Byggs som punkt i/direkt efter intag-passet.
- Demo-fråga till Mats (utan löfte): "skulle du vilja kunna
  förhöra agenten direkt i panelen?" — hans svar sätter prio.

## Öppna frågor

- Kind i kontraktet: återanvänd advisory_answer eller egen kind
  (kräver v0.4)? Samma fråga som eskaleringarna — ta ihop.
- Ska kundassistenten (kundappens chatt) och förhörschatten dela
  retriever? Troligen ja, olika scoper.
- Kostnadstak per tenant för chattfrågor (policyfråga, ADR?).
