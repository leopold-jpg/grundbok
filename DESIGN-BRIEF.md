# DESIGN-BRIEF — grundboks publika sajt (v3)

Mål: en publik sajt i nivå med de bästa SaaS-sajterna i kategorin
(referens: taxxa.ai — studera deras grepp, kopiera inte deras uttryck).
Dagens sajt är en fungerande wireframe; strukturen och kopplingarna
behålls, uttrycket görs om helt.

## Omfattning — HÅRD GRÄNS

Endast den publika ytan: src/app/page.tsx, dess komponenter och CSS,
plus /login-sidans utseende (samma formspråk). RÖR INTE /byra,
/operator, API:er, auth-logik eller kärnan. Kontaktboxen ska fortsatt
POST:a till befintliga leads-flödet. Mobil först — hero och kontaktbox
ska vara perfekta i telefon.

## Identitet: varm ljus produktförst-minimalism
## (v3 — låst 2026-07-10 mot Leopolds 18 vinnare i docs/design-referens/publik/)

Bilderna i docs/design-referens/publik/ är FACIT. Deras gemensamma
språk, som gäller:

- **Produkten först.** Hero = stor men inte monumental rubrik + kort
  copy + kedje-scenen som inramad produktskärm (mjuka hörn, tunn kant
  ~#ddd6c8, svag skugga) direkt i/under hero. Rubriken säger vad,
  scenen bevisar det. Scenen är sajtens hjärta — mest tid där.
- **Varmt ljust rakt igenom.** Papper (#F7F3EA), bläck (#2C2A26),
  rust (#A4502E) som varm accent som FÅR ta plats (CTA, markeringar,
  detaljer i scenen). Inga mörka inverterade sektioner, inga
  gradienter.
- **Typografi:** grotesk (Inter) bär rubriker och gränssnitt — stora
  grader, tight, lugnt. Serif (Fraunces) som varumärkeskrydda:
  ordmärket, enstaka display-ord eller kursiva betoningar — aldrig
  hela stycken. Mono för konton/lagrum/hash och markerade fraser.
- **Mjuka kort med tydlig kant** för inramat innehåll. Aldrig tunga
  skuggor eller glassmorphism.
- **Luft och få element** — men vinnarna VISAR innehåll snarare än
  gömmer det; inte Squarespace-radikal reduktion.
- Max ETT varmt fotografiskt/illustrativt inslag på hela sajten, och
  bara om det förtjänar sig.

## Arbetsytorna (nästa pass — EJ denna session)

Beslutat: LJUS arbetsyta i samma papper. Referens:
docs/design-referens/arbetsyta/ — Airtable-varm CRM där datan bär
färgen: statuschips, modulfärger, konfidensbadges på ljus bas. Tätt
men lugnt, generös radhöjd, mono-siffror.

## Hero: kedjan i rörelse (sajtens huvudnummer)

Vänster: en mening. "Framtidens redovisning attesterar sig själv" /
underrubrik om agenter + ansvarskedja (copy får vässas). En CTA:
"Ställ er på väntelistan".

Höger (eller under på mobil): EN levande produktscen byggd i kod
(Framer Motion eller ren CSS — INTE video, INTE bildsekvens):
ett kvitto glider in → tolkningen skrivs fram rad för rad (motpart,
konto 4010, moms 12 %, ML (2023:200) 9 kap., konfidens) → attest-
knappen trycks → verifikation #47 stämplas med hash. Loopar lugnt.
Använd riktiga UI-komponenter/samma visuella språk som /byra så att
scenen ÄR produkten. Detta är samma grepp som taxxas chatt-hero —
men vår kedja är något de inte kan visa.

## Sektioner, i ordning

1. **Hero** enligt ovan.
2. **Så funkar det** — tre steg med scrollanimation: släpp in
   underlaget (mejl/foto/API som ikonspråk i kvitto-estetik) →
   agenterna tolkar och konterar med lagrum → ni attesterar bara
   avvikelserna. Avsluta med raden "attesthögen krymper — det är
   produkten" och en liten kurva som illustrerar det.
3. **Förtroende/säkerhet** (ljus, typografiskt buren — tunna linjer,
   mono-detaljer, verifikations-estetik) — det som säljer
   till en försiktig byrå: hash-bundna beslut (en ändrad rad gör
   förslaget obeslutbart), radnivå-isolering per kund, ingen träning
   på er data, EU AI Act-hållning (human oversight som konfigurerbar
   mekanism), byggd på öppen kärna (GitHub-länk). Faktarutor i
   verifikations-estetik, inte ikon-grid.
4. **Moduler** — bokföring & rådgivning (live), löner/bokslut/skatt
   (kommande), kundappen (kommande: "era kunder fotar kvittot — det
   bokför sig självt"). Ärlig märkning, inga påhittade features.
5. **Väntelistan** — kontaktboxen (namn, byrå, e-post, fritext),
   premium-formulär, tydlig tack-vy. Detta är sajtens konvertering;
   den ska kännas som att skriva under något, inte fylla i något.
6. **Sidfot** — ordmärke, GitHub, en mening om öppen kärna, kontakt.

INGA testimonials eller kundlogotyper ännu — vi har inga, och påhittade
är förbjudna. Sektionen läggs till när Mats byrå är live.

## Motion-principer

Scrolldrivna avslöjanden (fade/translate, subtila), kedje-hero:n som
enda kontinuerliga animation, allt annat lugnt. Respektera
prefers-reduced-motion. Inga parallax-orgier, ingen scroll-hijacking.

## Kvalitetsribba

Ställ sajten bredvid taxxa.ai och linear.app: den ska kännas lika
avsiktlig men omisskännligt vara grundbok. Om en sektion känns som en
mall — gör om den. Hellre färre, perfekta sektioner än många halvbra.

## Assets att generera separat (Higgsfield/bildgenerering — EJ i
denna kodsession)

- Hero-bakgrundstextur: papper/fiber, mycket subtil
- Kvittofoton för "släpp in underlaget"-steget (stiliserade, svenska
  kvitton utan riktiga varumärken)
- Ev. og-image/social share i samma formspråk
Koden byggs med platshållare (solida ytor i paletten) där dessa ska in.
