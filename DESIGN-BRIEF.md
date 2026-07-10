# DESIGN-BRIEF — grundboks publika sajt (v2)

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

## Identitet: "papper som blivit levande"

Grundbok ÄR bokföring — kvitton, verifikationer, huvudbok. Identiteten
utvecklar studio-skinnet till premium i stället för att bli generisk
SaaS-gradient:

- **Palett**: dagens cream/papper som bas, mörknad och fördjupad —
  varm off-white (#F7F3EA-familjen), djup bläck-svart för text,
  rust/terracotta som ENDA accent (knappar, markeringar, ordmärkets
  "bok"). Gott om mörka partier är tillåtet (inverterade sektioner i
  bläck med cream-text) för kontrast och tyngd — men aldrig blå/lila
  tech-gradient.
- **Typografi**: serif för rubriker (samma familj som ordmärket,
  stora grader, tight leading), ren grotesk för brödtext, monospace
  för siffror/konton/lagrum (kvitto-känslan). Typografin är designen —
  hellre en enorm serif-rubrik på tomt papper än dekorationer.
- **Grafiskt språk**: kvittots och verifikationens formvärld —
  perforeringar, löpnummer, stämplar, tabellinjer, hash-strängar som
  texturelement. Inga generiska 3D-blobbar, inga emoji, inga
  stockilluminationer av människor vid laptops.

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
3. **Förtroende/säkerhet** (inverterad mörk sektion) — det som säljer
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
