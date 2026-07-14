# DESIGN-BRIEF — grundboks publika sajt (v4)

Mål: en publik sajt i nivå med de bästa SaaS-sajterna i kategorin.
v4 kodifierar riktningsbytet 2026-07-11 (vit/blå SaaS-produkt) och
ersätter v3 ("papper som blivit levande" är avvecklat som identitet;
kvittots formvärld lever kvar endast där den bär funktion). Läses
med DESIGN-INSPO.md (v2) och facit-bilderna:

- STRUKTUR: docs/design-referens/saas/ (taxxa + utvalda vinnare)
- TEMPERATUR: Rote-referensen i samma mapp är palett-facit
- Märket: docs/brand/ (D1 — blå variant tills namnbeslutet)

## Omfattning — HÅRD GRÄNS

Endast den publika ytan: src/app/page.tsx, dess komponenter/CSS
(src/app/_publik/) och /login-sidans utseende. RÖR INTE /byra,
/operator, auth-logik eller kärnan. API:er rörs endast på uttrycklig
beställning (hittills en: POST /api/leads exponerar lead-id för
väntelistans kvittens). Delade layout.tsx/globals.css rörs aldrig —
publika ytan scopar fonter och variabler själv. Mobil först — hero
och väntelistan ska vara perfekta i telefon.

## Identitet: vit/blå SaaS-produkt

- **Bas**: rent kallvitt (#FFFFFF) med sektionsband i isblått
  (#F5F8FC). Kort: vita, kant #E3E9F2, svag skugga. Skuggor och
  djup får användas (subtilt) — mjukvara, inte papper.
- **Text**: nästan-svart kallgrå (#0F172A), sekundär #475569,
  tertiär #64748B. Alla nivåer AA-räknade.
- **Accent**: EN klarblå (#2563EB) — CTA, länkar, kedje-scenens
  detaljer, simulatorns attest-kvadrater, beam-pulsen, D1-märkets
  accentpixel. Hover #1D4ED8.
- **Status**: grönt (#15803D för text) ENDAST som status — stämplar
  (Attesterad/Registrerad), LIVE-chips. Inget mer.
- **Mörk kontrastyta**: djup marinblå (#0B1B34) för sidfoten; EN
  subtil blå gradient på mörk yta är tillåten. Inga gradient-orgier.
- **Typografi**: Inter bär rubriker och gränssnitt (600, tight,
  måttlig skala ~48–64/32–40 px). Instrument Serif ENDAST som
  varumärkeskrydda: ordmärket och enstaka kursiva betoningar.
  IBM Plex Mono ENDAST för siffror, konton, hash och reg-id —
  aldrig etiketter, sektionsnummer eller knappar; etiketter sätts
  i grotesk small-caps (11px/600/uppercase).
- **Kvitto-manér** (perforering, zigzagkant, mono-kvitto) lever
  ENDAST i kedje-scenen och D1-märket — aldrig som allmän dekor.
  Inga №-tecken utan funktion.

## Struktur (taxxa-mönstret, i ordning)

1. **Hero**: centrerad rubrik ("Framtidens redovisning attesterar
   sig själv" — betoningen i blå serif-kursiv) + kort copy + EN CTA,
   ambient pixelliv i bakgrunden (D1-språket, låg opacitet, dolt på
   mobil), och kedje-scenen som inramad produktskärm direkt under.
2. **(Vilande) social proof-rad** — LogotypRad-komponenten är byggd
   men renderas INTE förrän riktiga kundlogotyper finns.
3. **Så funkar det** (isblått band): tre illustrerade SVG-paneler
   med loopande mikrodetaljer, max en mening per steg. Avslutas med
   "attesthögen krymper — det är produkten" + den interaktiva
   simulatorn: reglage för underlag/månad och andel rutin, rutnät
   där attest-högen (blå) läses först, resultat och kurva som REN
   ARITMETIK av besökarens tal.
4. **Förtroende är arkitektur** (vitt): EN ritad figur — underlag →
   förslag → hash → attest (blå, behörig människa)/policy →
   append-only huvudbok — med de fyra poängerna som etiketter i
   figuren och animated beam som pulserar genom flödet. En rad
   brödtext under, inte fyra stycken.
5. **Moduler** (isblått band): bento-grid — live-modulerna stora
   med levande ikondetaljer, kommande dämpade. Max en mening per
   modul, ärlig live/kommande-märkning.
6. **Väntelistan** (vitt): boxade fält med blå fokusring, aktiv
   submit ("Skriver in …" + rullande reg-ticker), kvittens med grön
   Registrerad-stämpel, VERKLIGT reg-id (ur API-svaret, tickas fram)
   och mottagningstid. Konverteringen ska kännas som att skrivas in
   i systemet.
7. **Sidfot** (marin): ordmärke, öppen kärna-meningen, GitHub,
   kontakt→väntelistan, login, © Leopold Seifert.

## Kedje-scenen (sajtens hjärta — behålls)

Kvittot glider in → tolkningen skrivs fram rad för rad (motpart,
konto 4010, moms 12 %, ML (2023:200) 9 kap., konfidens) → attest-
knappen trycks → verifikation 47 stämplas (grönt) med hash. Samma
exempeldata som demon, märkt "exempeldata". Produktfilm-känsla:
statisk layout, mjuka fokusskiften, stämpeln landar mjukt.

## Rörelse

Scroll-avslöjanden med självförtroende (staggered reveals, reg-
ticker, beam) men: prefers-reduced-motion respekteras överallt
(fruset slutläge + CSS-överstyrning av framer-inline-stilar),
pausknapp på kedje-loopen (WCAG 2.2.2), hydration-säkert (servern
renderar alltid det statiska läget), visibilitychange nollställer
loopar, aldrig scroll-hijacking. Max EN wow-effekt per vy (beamen).

## Komponentmönster

Magic UI/Aceternity/shadcn är MÖNSTERKÄLLOR: läs källkoden, förstå
mönstret, återimplementera mot våra CSS-variabler och Motion-setup.
Aldrig Tailwind som beroende. Fristående komponenter byggs med
props-kontraktet { spelar: boolean } (från useSpelar: mounted &&
!prefers-reduced-motion) och endast CSS-variabler — så kan de byggas
parallellt i worktrees utan att röra page.tsx/publik.css.

## Vad som är förbjudet (oförändrat sedan v1)

Påhittade siffror, kunder, citat, logotyper eller features. Allt
värde i simulatorn kommer ur besökarens egna tal. Testimonials och
logotypraden aktiveras först när Mats byrå är live. Emoji-ikoner.
Mer än en wow-effekt per vy.

## Öppna punkter

- Ordmärket/loggan: RÖRS INTE — väntar på namnbeslutet (D1:s
  rust-varianter ligger kvar i docs/brand/ parallellt med blå).
- og-image/social share i nya systemet (genereras separat).
- Sidtiteln "vertikal skiva" bor i delade layout.tsx → egen liten PR.
- Arbetsytorna (/byra, /operator) görs om i NÄSTA pass — ljusa, i
  samma system; referens: docs/design-referens/arbetsyta/.
