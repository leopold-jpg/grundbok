# GRUNDBOK — MASTERPLAN

*Uppdaterad 2026-07-14, efter publika sajtens design-pass (PR #3).*
*Detta dokument är kartan. Kickoff-filerna är sessionerna. ADR:erna är besluten.*

## Visionen i en mening

Framtidens redovisning: kunden (byrån eller bolaget) släpper in sin aktivitet
— mejl, foto, chatt, API — och specialistagenter tolkar, konterar och föreslår
enligt gällande rätt; människan attesterar bara avvikelserna, och andelen
avvikelser sjunker över tid via policy. Allt spårbart, hash-bundet, AI Act-redo.

## De tre ytorna (personerna)

| Yta | Vem | Innehåll | Ser ALDRIG |
|---|---|---|---|
| **Publik sajt** | Blivande kund | "Framtidens redovisning", produkt-preview, kontaktbox/väntelista | Riktig data |
| **Byråns arbetsyta** | Byråns konsulter | Attestkö, chatbot (rådgivning + lagfrågor), mejl-intag, deras kunder, deras beslutslogg | Andra byråers data |
| **Operatörskonsolen** | Leopold/Mats (grundare) | Bolag → agenter → status, provisionering, policys, hälsa, (senare: billing) | Kvitton, attest, kunddata |
| **Kundappen** | Klientbolaget (byråns kund) | Fota/skicka in kvitton, kvittens & status, kundassistent-chatt, egen mejladress in | Konteringar, attestkön, andra bolag |

Regeln som löser kvällens förvirring: **attest bor hos byrån, drift bor hos
operatören.** Grundaren godkänner aldrig ett kvitto.

Kundappens affärslogik: **byrån köper systemet — klienten får en
kommunikationsväg.** Appen säljs aldrig till småbolag direkt; den är en
förmån byrån ger sina klienter ("fota kvittona i vår app"), vilket gör
varje vunnen byrå till distribution. Klienten bjuds in av sin byrå och
ser bara sitt eget bolag. v1 är en PWA (hemskärmsapp utan App Store),
riktig app senare om byråerna ber om det.

Kundassistenten (chatten i appen) svarar ENDAST om kundens egna underlag
och status ("har ni fått mitt kvitto?", "vad var fakturan från X i mars?")
— aldrig redovisnings- eller skatteråd; det är byråns roll och relation.
Fallback för rådgivningsfrågor: "vill du att jag skickar frågan till din
revisor?" → ärende i byråns arbetsyta med underlaget länkat. Kundfrågor
som idag kommer på sms/telefon samlas därmed i byråns kö.

## Lagren (nerifrån upp)

1. **Kärnan** ✅ *byggd (PR #1)* — förslagskontraktet (ADR-0002), beslutsmotorn
   (hash räknas om vid beslut), autonomipolicy per tenant/modul, append-only
   huvudbok med RLS, correction aldrig auto.
2. **Runtime/control plane** ✅ *byggd (PR #1)* — agents-tabellen (ADR-0003:
   en agent är en rad), scopade nycklar (föreslå, aldrig bokföra), kö med
   pgmq-semantik, generisk worker (buildProposal = ren funktion, samma kod
   i moln och OpenClaw), provisionAgent (Stripe-förberedd).
3. **Moduler** — bokforing ✅, radgivning ✅ (RAG, lagrum, konfidens),
   kundassistent ⬜ (kundappens chatt: egna underlag/status, aldrig råd,
   eskalering till byrån — återanvänder rådgivningens maskineri med
   snävare scopes), loner ⬜ (trappa: rådgivare → kontering → aldrig egen
   beräkningsmotor, integrera i stället), bokslut ⬜, skatt-juridik ⬜.
4. **Intag** ⬜ — mejladress per byrå (vidarebefordra faktura → förslag),
   foto/upload, chatbot-intag, POST /api/intake för externa botar (OpenClaw
   blir dum kurir: underlag in, inget mer).
5. **Ytorna** ✅ *byggda (PR #2)* — publika sajten omdesignad (PR #3);
   /byra, /operator, /login designas om i D2 (auditlistan i
   docs/design-system.md).
6. **Auth** ✅ *byggd (PR #2)* — två roller: operator, byrå-konsult (per
   tenant). decided_by = verifierad identitet.
7. **Kommersialisering** ⬜ — branschmallar för policys (bygg: omvänd
   betalningsskyldighet förifylld; restaurang: livsmedelskonton),
   Stripe-checkout → provisionAgent-webhook, prissättning per agent/modul.

## Roadmap i sessioner

| # | Session | Innehåll | Status |
|---|---|---|---|
| S1 | Modulplattform | Kärna + runtime + 2 moduler (WP0–WP10) | ✅ PR #1 |
| S2 | **Ytor + auth** | WP11–WP15: auth, publik sajt, byråns arbetsyta, bantad operatörskonsol | ✅ PR #2 |
| D1 | Design: publik sajt | DESIGN-BRIEF v2→v4, publika sajten v2→v7 (vit/blå), designsystemet extraherat till docs/design-system.md + tokens konsoliderade | ✅ PR #3 |
| S5 | Mallar + Stripe | branschpolicys, checkout → webhook → provisionAgent | 🔜 **nästa** |
| D2 | Design: arbetsytor | /byra, /operator, /login in i designsystemet — auditlistan i docs/design-system.md är arbetslistan | efter mallarna |
| S4 | Deploy | Supabase-moln (pgmq-adapter klar), Vercel, domän, env | efter arbetsytorna |
| S3 | Intag + kundkanal | /api/intake, mejladress per klient (inbound webhook), kundappen (PWA: fota kvitto, kvittens/status, kundassistent-chatt med eskalering till byrån), OpenClaw-skill | efter deploy |
| S6+ | Moduler | loner steg 1–2, bokslut, skatt-juridik (fler källor på rådgivnings-RAG) | efter pilotfeedback |

Ordningen framåt (beslut 2026-07-14): **mallar → arbetsytor → deploy.**
Tabellen står i den ordningen; sessionsnumren är historiska och byter inte namn.

## Demo för Mats (efter S2)

1. Publika sajten — visionen, kontaktboxen. 30 sek.
2. Logga in som byrå: mejla/klistra in en faktura → dyker i attestkön med
   konto, moms, lagrum → attestera → verifikation. 3 min.
3. Ändra policy → nästa likadana faktura bokförs själv, syns i loggen som
   policy-beslut. "Så krymper attesthögen." 1 min.
4. Växla till operatörskonsolen: bolag → agenter → provisionera en ny på
   en sekund → pausa → 403. "En kund är en config." 2 min.

## Principer att inte kompromissa (från ADR:erna)

- Enda skrivvägen är förslagskontraktet. Inga sidodörrar, inte ens för intag.
- Nyckel kan föreslå, aldrig bokföra. Correction kräver alltid människa.
- Policy bor i kärnan, aldrig i agenten. Autonomi är en ratt per kund.
- Agentkod = rena funktioner. Samma kod i OpenClaw (dev) och moln (prod).
- Varje förslag bär modell, promptversion, konfidens, lagrum → AI Act-spår.
