# DESIGN-INSPO — resurser för sajtbygget

Läses tillsammans med DESIGN-BRIEF.md och bilderna i docs/design-referens/.
Bilderna är FACIT för känslan. Resurserna nedan är verktyg och skelett —
regeln för varje lån: **låna struktur och teknik, aldrig utseende.**
Allt visuellt (färg, typografi, spacing) kommer ur briefen och bilderna.

## Typografi — det viktigaste valet (80 % av looken)

Display-serifen bär hela identiteten. Prova dessa tre i storgrad
(120px+) med rubriken "Framtidens redovisning attesterar sig själv"
och visa alla tre innan valet låses:

- **Fraunces** (github.com/undercasetype/Fraunces, Google Fonts) —
  open source-serif med "wonk"-axlar; i tunga vikter mycket nära
  referensbildernas didone-känsla. Trolig vinnare.
- **Instrument Serif** (Google Fonts) — skarp, elegant display-serif,
  bara en vikt men den vikten är rätt.
- **Playfair Display** (Google Fonts) — säkrare/klassisker didone,
  fallback om de andra inte sitter.

Brödtext: **Inter** (github.com/rsms/inter) — neutral grotesk, stör
aldrig. Mono för siffror/konton/lagrum: **IBM Plex Mono** (github.com/
IBM/plex) eller JetBrains Mono. Ladda via next/font (self-hosted,
ingen FOUT), inte CDN.

## Motion

- **Motion (Framer Motion)** — github.com/motiondivision/motion,
  docs på motion.dev. Används för kedje-scenen i hero:n och
  scroll-reveals. Håll dig till: staggered fade/translate vid scroll
  (whileInView), typewriter-liknande radavslöjande i kedje-scenen,
  layout-animation på attest-stämpeln. Inget mer.
- Respektera prefers-reduced-motion (useReducedMotion-hooken).

## Sektionsskelett (struktur, ALDRIG stil)

- **HyperUI** — github.com/markmead/hyperui. Får konsulteras för HUR
  en sektion byggs responsivt (grid-struktur, brytpunkter för
  hero/kolumner/formulär). Tailwind-klasserna översätts till våra
  CSS-tokens — kopiera aldrig färger, skuggor, rundningar eller
  typskala därifrån.
- **shadcn/ui** — github.com/shadcn-ui/ui. Endast som referens för
  tillgänglighetsmönster (focus-states, aria på formulär och dialoger).
  Inte komponenterna själva — vi har eget formspråk.

## Vad som INTE får hämtas någonstans

Färdiga hero-mallar, testimonial-karuseller, pricing-tables,
gradient-bakgrunder, glassmorphism, dark-tech-estetik. Ser resultatet
ut som en mall är det fel — referensbilderna avgör.

## Arbetsordning för sessionen

1. Titta på alla bilder i docs/design-referens/ FÖRST.
2. Sätt typografin (tre prov enligt ovan) och tokens.
3. Bygg hero:n ensam till den sitter — den definierar allt nedanför.
4. Sedan sektion för sektion enligt briefen, med HyperUI som
   strukturuppslag vid behov.
