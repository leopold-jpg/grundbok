# GRUNDBOK — MASTERPLAN

*Uppdaterad 2026-07-08 kväll, efter modul-plattform (PR #1).*
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

Regeln som löser kvällens förvirring: **attest bor hos byrån, drift bor hos
operatören.** Grundaren godkänner aldrig ett kvitto.

## Lagren (nerifrån upp)

1. **Kärnan** ✅ *byggd (PR #1)* — förslagskontraktet (ADR-0002), beslutsmotorn
   (hash räknas om vid beslut), autonomipolicy per tenant/modul, append-only
   huvudbok med RLS, correction aldrig auto.
2. **Runtime/control plane** ✅ *byggd (PR #1)* — agents-tabellen (ADR-0003:
   en agent är en rad), scopade nycklar (föreslå, aldrig bokföra), kö med
   pgmq-semantik, generisk worker (buildProposal = ren funktion, samma kod
   i moln och OpenClaw), provisionAgent (Stripe-förberedd).
3. **Moduler** — bokforing ✅, radgivning ✅ (RAG, lagrum, konfidens),
   loner ⬜ (trappa: rådgivare → kontering → aldrig egen beräkningsmotor,
   integrera i stället), bokslut ⬜, skatt-juridik ⬜.
4. **Intag** ⬜ — mejladress per byrå (vidarebefordra faktura → förslag),
   foto/upload, chatbot-intag, POST /api/intake för externa botar (OpenClaw
   blir dum kurir: underlag in, inget mer).
5. **Ytorna** ⬜ — se ovan. Attestkö-koden FINNS (v0-admin) men bor hos fel
   person; flyttas, inte byggs om.
6. **Auth** ⬜ — Supabase Auth, två roller: operator, byrå-konsult (per
   tenant). decided_by = verifierad identitet. Krav innan första riktiga kund.
7. **Kommersialisering** ⬜ — branschmallar för policys (bygg: omvänd
   betalningsskyldighet förifylld; restaurang: livsmedelskonton),
   Stripe-checkout → provisionAgent-webhook, prissättning per agent/modul.

## Roadmap i sessioner

| # | Session | Innehåll | Status |
|---|---|---|---|
| S1 | Modulplattform | Kärna + runtime + 2 moduler (WP0–WP10) | ✅ ikväll, PR #1 |
| S2 | **Ytor + auth** | WP11–WP15: auth, publik sajt, byråns arbetsyta, bantad operatörskonsol | → KICKOFF-YTOR.md |
| S3 | Intag | /api/intake, mejl-in (inbound webhook), foto, OpenClaw-skill (10 rader) | efter S2 |
| S4 | Deploy | Supabase-moln (pgmq-adapter klar), Vercel, domän, env | efter S2/S3 |
| S5 | Mallar + Stripe | branschpolicys, checkout → webhook → provisionAgent | inför försäljning |
| S6+ | Moduler | loner steg 1–2, bokslut, skatt-juridik (fler källor på rådgivnings-RAG) | efter pilotfeedback |

Merge-ordning: PR #1 granskas och mergas FÖRE S2 startar.

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
