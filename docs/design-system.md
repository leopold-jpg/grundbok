# grundbok — designsystem

*Extraherat 2026-07-14 ur publika sajten på main (PR #3 mergad — hela
v2→v7-resan). DESIGN-BRIEF.md v4 är beställningen; det här dokumentet är
systemet som faktiskt byggdes, formulerat som regler för ALLA ytor.
Normativt: nya ytor följer detta; avvikelser i befintliga ytor listas i
auditen sist och åtgärdas i arbetsyte-passet (D2 i masterplanen).*

## 1. Tokenarkitekturen — EN källa

Alla tokens bor i `design.tokens.css` (repo-roten), importerad av
`src/app/globals.css` som `layout.tsx` laddar globalt. Tre lager i
kaskadordning:

1. **Gesso-grammatiken** — neutral strukturbas: `--sp-*` (4px-skala),
   `--r-*` (radier), `--tracking-*`, `--dur-*`/`--ease-*`, semantiska
   färgslots. Brand-neutral; ändras inte av identitetsbyten.
2. **Studio-skinnet** — varm papper/terracotta. GAMMAL identitet; bär
   numera ENDAST adminkonsolen via globals.css tills dess eget pass.
3. **Grundbok-skinnet** — vit/blå (riktningsbytet 2026-07-11).
   GÄLLANDE identitet. Ligger på `:root` så varje yta når tokens utan
   lokal deklaration.
4. **Arbetsyte-mappningen** (D2-passet 2026-07-18) — `main.byra` och
   `main.operator` mappar grammatik-slotsen (`--bg/--fg/--accent/--ring`
   …) till grundbok-värden, scopat per yta enligt publik-mönstret.
   Mappningen bor i tokenfilen (inte i yte-CSS:en) så källan förblir EN;
   globals.css-klasserna byter därmed skinn utan att adminkonsolen rörs.

Regler:

- **Ytor dubbeldefinierar ALDRIG token-namnen lokalt.** Publik och
  login konsumerar; dubbletterna som låg i publik.css/login.css är
  borttagna och får inte återuppstå.
- Mono-kedjan (`--font-mono` med IBM Plex Mono först) scopas i
  tokenfilen till ytor som fäster `plexMono.variable` på `<main>`
  (`main.publik`, `main.login-sida`, `main.byra`, `main.operator` — via
  `src/app/_publik/fonter.ts`).
  Ny yta som ska visa mono-värden: fäst variabeln och lägg till
  selektorn i tokenfilen.
- `--font-sans`/`--font-serif` sätts i globals.css `:root` med
  next/font-variablerna (`--font-app-sans`, `--font-app-serif`) först i
  kedjan — self-hostat, aldrig beroende av Google Fonts vid runtime.
- Ändras ett färgvärde måste kontrasten räknas om (nuvarande värden är
  AA-räknade: blå 5,2:1 åt båda håll, grön text 5,0:1, marin ≥6,7:1,
  `--ink-svag` på vitt ≈ 4,8:1).

## 2. Färg

| Token | Värde | Roll |
|---|---|---|
| `--yta` | `#FFFFFF` | Sidbas — rent kallvitt |
| `--yta-is` | `#F5F8FC` | Sektionsband (`section.is-yta`) — ALDRIG helsidesyta |
| `--kort` | `#FFFFFF` | Kortyta |
| `--ink` | `#0F172A` | Primärtext (nästan-svart kallgrå) |
| `--ink-mjuk` | `#475569` | Sekundärtext |
| `--ink-svag` | `#64748B` | Tertiärtext, etiketter |
| `--linje` | `#E3E9F2` | Hårfin kant — bär strukturen |
| `--linje-stark` | `#CBD5E1` | Betonad kant, sektionslinjal, perforering |
| `--bla` | `#2563EB` | DEN enda accenten |
| `--bla-djup` | `#1D4ED8` | Accent-hover |
| `--bla-ljus` | `#60A5FA` | Ljus blå detalj i illustrationer |
| `--gron` | `#15803D` | ENDAST status |
| `--varning` | `#B45309` | ENDAST status på arbetsytorna (flaggor, nyckelvarning) |
| `--marin` | `#0B1B34` | Mörk kontrastyta (sidfoten) |
| `--marin-fg` / `--marin-mjuk` / `--marin-linje` | `#F8FAFC` / `#94A3B8` / `rgba(148,163,184,0.22)` | Förgrund/sekundär/kant på marin |
| `--fel` | `#DC2626` | Felmeddelanden |

- **EN klarblå accent.** CTA, länkar, fokusringar, kedje-scenens
  detaljer, beam-pulsen, simulatorns policy-kvadrater, D1-märkets
  accentpixel. Sprids aldrig som dekor.
- **Grönt ENDAST som status**: stämplarna (Attesterad/Registrerad),
  LIVE-chips, status-bocken i illustrationer. Inget annat.
- **Marin** är sidfotens yta; EN subtil blå gradient på mörk yta är
  tillåten (`radial-gradient` + `--marin`). Inga gradient-orgier.
- **Inga hex/rgba i TSX/SVG.** All färg i komponenter går via
  `var(--…)` — verifierat: noll hex i `_publik/` + page.tsx (enda `#`
  är hash-textinnehållet `"#9f2c…"`). Illustrationer använder max EN
  blå accentdetalj per motiv; grönt endast som status-bock.
- **Varningsfärgen är beslutad i D2** (2026-07-18): `--varning #B45309`
  (amber-700, AA: 5,0:1 på vitt, 4,7:1 på `--yta-is`) finns i kanon för
  arbetsytornas statusbehov — flaggkanter, avvikelsemarkörer,
  engångsnyckel-varningen. Som grönt: ENDAST status, aldrig dekor, och
  den används inte på publika ytan.

## 3. Typografi

- **Inter bär rubriker och gränssnitt.** Vikt 600, `--tracking-tight`,
  måttlig skala: hero `clamp(40px, 6.5vw, 64px)`, sektionsrubriker
  `clamp(26px, 3.6vw, 38px)`. Body 16px på publika ytan.
- **Instrument Serif är ENDAST varumärkeskrydda**: ordmärket
  (`grund<em>bok</em>`) och enstaka `<em>`-betoningar i blå
  serif-kursiv där betoningen bär sektionens kärnpåstående
  ("attesterar sig själv", "det är produkten"). Serifen finns i EN
  vikt (`--serifvikt-* = 400`) — betoning görs med kursiv, aldrig
  vikt. Serif som bärande rubrikfont är förbjudet.
- **IBM Plex Mono ENDAST för siffror, konton, hash och reg-id.**
  Aldrig etiketter, sektionsnummer, knappar eller löptext. Tickers
  sätter alltid `font-variant-numeric: tabular-nums`. Regeln är
  semantisk: ser besökaren mono är det ett verkligt värde ur systemet.
  Gränsfall avgörs åt sans-hållet (lagrum-chippen "ML (2023:200)" är
  sans-etikett).
- **Etiketter är grotesk small-caps**: 11px / 600 / uppercase /
  spärrning 0.08em (standardvärdet; 0.1–0.14em förekommer för
  scen-noter). Aldrig mono, aldrig serif.
- **Sektionsnummer** ("01"–"04") sätts som ren grotesk `.lopnr`
  (12px/600, blå) — inget №-manér.

## 4. Kort, glass, skuggor

- **Kortreceptet**: vit `--kort`, 1px `--linje`, radie `--r-lg` (14px)
  för standardkort, `--r-xl` (20px) för stora formulärkort
  (väntelistan) och glass. En radienivå per nesting-lager — kontroller
  ett steg tätare än kortet de sitter i.
- **Skuggsemantik**: `--skugga-kort` = vilande (kort som ligger i
  flödet), `--skugga-lyft` = svävande (hero-scenen, glass,
  hover-lyft). Kanten bär strukturen; skuggan är atmosfär. Skuggor är
  kalla (`rgba(15,23,42,…)`), aldrig färgade, aldrig hårda.
- **Glass-accenten** (`.glass-kort`, via `--glass-*`-tokens: vit frost
  0.55, blur 20px + saturate 1.4, kant `rgba(255,255,255,0.75)`,
  `--r-xl`, `--skugga-lyft`) får ENDAST användas i
  förtroendesektionen — där den frostar över sektionens flytande blå
  ljusfläckar (två radial-gradients i `.trygghet::before`) — samt som
  navets blur (`.sajt-topp`, blur 10px på 88 % vit). Ingen annanstans.
  `@supports not (backdrop-filter)`-fallback: solid `rgba(255,255,255,0.92)`.
  Glass på platt yta utan ljus bakom är förbjudet — då gäller
  hårfina-kanten-kortet.
- **Kvitto-manéret** (perforering, zigzagkant, mono-kvitto,
  stämpel-rotation) lever ENDAST i kedje-scenen och D1-märket — aldrig
  som allmän dekor.
- **Hover-lyft** (bento-korten): `box-shadow` → `--skugga-lyft` +
  `translateY(-2px)`, `--dur-med` `--ease-out`, släcks vid reduced
  motion.

## 5. Spacing & layout

- `--sp-skalan` (4px-bas) är sluten — välj ur skalan, hitta inte på
  mellanvärden. Kända avstickare i komponenterna (gap 10, padding 22,
  negativa marginaler) är skuld, inte prejudikat (se §8).
- Innehållsbredd: `.inre` max-width 1120px med
  `padding-inline: clamp(20px, 5vw, 56px)`. Sektionrytm:
  `padding-block: clamp(40px, 5.5vw, 72px)`; isblåa band växlar med
  vita.
- Mobil först: hero och väntelistan perfekta i telefon; inputs ≥16px
  (hindrar iOS-zoom); grid-kontraktet nedan ger 1 kolumn som default.
- **Grid-kontraktet för fristående komponenter**: inline
  `display: grid` UTAN `gridTemplateColumns` (mobil-fallback 1
  kolumn); publik.css sätter kolumnerna vid brytpunkterna. Komponenter
  sätter aldrig responsiva kolumner inline.
- **Fristående komponenter** (worktree-mönstret): bär basstil som
  CSSProperties med tokens via `var(--…)`, exponerar klassnamn som
  krokar för publik.css, tar `{ spelar: boolean }` som props-kontrakt.
  Så kan de byggas parallellt utan att röra page.tsx/publik.css.

## 6. Rörelse

### useSpelar — det enda animationskontraktet

- `useSpelar()` returnerar `spelar: boolean` = `mounted &&
  !prefers-reduced-motion`. Staten startar alltid `false` och flippas
  efter montering. Fristående komponenter läser ALDRIG hooken själva —
  varje sektionsförälder anropar den en gång och skickar `spelar` som
  prop.
- **Preferensen läses vid mount.** framer-motions `useReducedMotion`
  är i praktiken inte reaktiv (12.42.2: `useState(prefersReducedMotion.current)`
  utan prenumeration — dokumentationen lovar mer än implementationen
  håller). Dynamiskt skydd mitt i sessionen kommer i stället från
  CSS-lagret: `@media` är levande och `!important`-blocket slår
  omedelbart. Känd lucka: JS-drivna tickers reagerar på en
  mid-session-toggle först vid omladdning; en äkta lösning kräver en
  egen matchMedia-lyssnare i useSpelar (D2-kandidat, inte akut).

### Hydration-säkerhet

- Servern och första klientrenderingen renderar EXAKT samma träd,
  alltid `spelar=false`. Det statiska läget är ett KOMPLETT slutläge
  (innehållet syns utan JS), aldrig ett tomt startläge.
- Identisk DOM för ett givet spelar-värde — endast animationsprops får
  skilja (`initial={false}`-mönstret + keyframe-listor `[0, 1]` så
  animationen ändå spelar när spelar flippar efter mount). KedjeScen
  är enda undantaget med separat frusen DOM-gren; normen för nya
  komponenter är identisk DOM.
- Ingen `Math.random`, ingen `Date.now` — all "slump" härleds
  deterministiskt ur index/position.

### Reduced motion — dubbelt skydd

1. **JS-vägen**: `spelar=false` ⇒ stilla komplett slutläge.
2. **CSS-vägen**: `@media (prefers-reduced-motion: reduce)`-blocket
   sist i publik.css överstyr framers inline-stilar med `!important`
   (`[data-reveal]` → opacity 1, transform none, transition none) och
   släcker caret, stämpel-in och bento-hover. Behövs eftersom
   scroll-reveals (`whileInView`) animerar oberoende av spelar —
   **varje nytt scroll-avslöjande MÅSTE bära `data-reveal`**, annars
   läcker rörelse igenom.
- **Tickers/räknare blir aldrig "frusna"**: vid `spelar=false` visas
  exakt rätt värde direkt och nya värden byts omedelbart utan
  animation (TalTicker/RegTicker/NrTicker; simulatorkvadraternas
  färg-transition blir `none` men värdet styr fortfarande).

### Loopar, paus, synlighet

- **Pausknapp på kontinuerliga loopar (WCAG 2.2.2)**: kedje-scenens
  pausknapp renderas som SYSKON till scenen (utanför
  `role="img"`/aria-hidden) med växlande etikett; stilen är stillsam
  (liten mono-versal, understruken, under scenkortet) med blå
  `:focus-visible`-ring. Paus stoppar hela tidslinjen; återupptagning
  startar om från steg 0 — "en halvfryst kedja är ingen berättelse".
- **visibilitychange nollställer loopar** (Chrome throttlar timers i
  bakgrundsflikar): börja om från början, försök aldrig "hinna ikapp".
- **Berättande loopar drivs av en explicit tidslinje**
  (`TIDSLINJE = [steg, vidMs][]`, timers med cleanup); steg-numret är
  enda animationsdrivaren (`synlig = steg >= n`), aldrig egna timers i
  delkomponenter.

### Max EN wow per vy

Varje sektion har högst EN bärande rörelseeffekt; allt annat är lugna
mikrodetaljer (6–9 s loopar, endast transform/opacity/pathLength):

| Vy | Wow | Mikrodetaljer |
|---|---|---|
| Hero | Kedje-scenen (sajtens enda kontinuerliga animation) | Hero-pixlarna, ambient 0.04–0.16 opacitet |
| Så funkar det | Interaktiva simulatorn med tickande utfallskort | Panelernas SVG-loopar |
| Förtroende | Animated beam genom arkitekturfiguren | Trygghetsillustrationernas pulser |
| Moduler | De TVÅ live-kortens ikonanimation | Kommande-kort alltid `spelar=false`, dämpade |
| Väntelistan | Reg-tickern (rullar under inskrivning, landar verkligt id) | — |

### Parallax-reglerna

Scroll-parallax finns på EXAKT ett ställe: hero-kubernas yttre lager
(scrollY [0, 900] → y [0, −64·djup]; större kub = mer parallax). Alltid:
endast när `spelar=true`, `pointer-events: none`, bakom innehållet,
HELT dolt under 720px, mycket låg opacitet. Grammatikens baslinje är
"no parallax" — hero-kuberna är det enda, medvetna undantaget.
Parallax på innehåll och scroll-hijacking är förbjudet.

### Ticker-mönstret

Alla "systemet tickar"-effekter: varje teckenposition rullar
deterministiskt genom sitt alfabet (startindex ur positionen) och
landar vänster→höger; landade tecken kommer ALLTID ur `varde`. Klocka:
`useAnimationFrame`. Parametrar: RegTicker (hex; 45 ms/tecken, stagger
70 ms, bas 420 ms ≈ 1 s för 8 tecken), TalTicker (siffror; 40/45/140 ms
— snabb nog att hinna med reglaget; icke-siffror står stilla), NrTicker
(väntesignal under inskrivning; landar ALDRIG ett tal — inget påhittat
nummer i något läge). Typografi: alltid mono + tabular-nums +
`white-space: pre`.

Marquee-varianten (LogotypRad, vilande): två identiska sekvenser,
translateX 0 → −50 % linjärt 28 s/varv, dubbletten `aria-hidden`,
`spelar=false` ⇒ stillastående.

### Scroll-avslöjanden (Reveal)

Ett delat mönster: opacity 0→1 + y 22→0, 0.55 s, ease
`[0.22, 1, 0.36, 1]`, `viewport { once: true, margin: "-60px" }` —
en gång, aldrig baklänges. Syskon staggas `i · 0.08 s`. Bär alltid
`data-reveal`.

### Timing-tokens

- CSS: `--dur-fast` 120 ms (hover/fokus), `--dur-med` 200 ms
  (kortlyft), `--dur-slow` 360 ms (reserv); `--ease-out`
  `cubic-bezier(0.22, 1, 0.36, 1)` som standardkurva.
- Framer-scener använder samma bezier som litteral (`LUGN`,
  duration 0.5–0.6 s) — CSS- och JS-rörelse ska kännas som ETT system.
  (Kurvan ligger i tre kopior; dela en exporterad konstant vid nästa
  städning — framer kan inte läsa CSS-variabler.)
- Kontinuerliga loopar är långsamma (mikroloopar 6–9 s, beam-period
  5.4 s med gemensam cykellängd så staggningen ligger fast, pixelcykel
  26 s, kedje-cykel ~13,5 s), alltid easeInOut — inga studsar, inga
  springs.

### Layout-invarianten

Animation påverkar ALDRIG layout: endast opacity, transform och
pathLength — aldrig width/height/margin/display. Loopar ändrar aldrig
sidhöjd (kedje-scenens verifikation är `position: absolute` ovanpå
flödet). Vid omstart tonas innehållet ut med opacity medan ramen står
kvar.

### Rörelse och skärmläsare

Animerade ytor är presentationella: `role="presentation"` +
`aria-hidden` på SVG-scener, `role="img"` + fullständig svensk
`aria-label` på kedje-scenen (beskriver mekaniken, inte adjektiv).
Rullande siffror ligger ALDRIG i en live-region — i simulatorn bär
reglagets `aria-valuetext` hela utfallet. Interaktiva kontroller som
hör till en animation (pausknappen) placeras utanför den aria-gömda
ytan.

## 7. Berättarprinciper

1. **Visa mekanik i stället för påståenden.** Rubriken får påstå —
   scenen direkt under ska bevisa. Kedje-scenen SPELAR kedjan (kvitto →
   tolkning rad för rad → attest → stämplad verifikation med hash) i
   stället för att beskriva den. Pröva ny copy mot frågan: kan detta
   visas som ett förlopp i stället?
2. **Illustrationen bär, texten kvitterar.** Max EN mening per steg,
   modul och löfte. Behövs två meningar är det scenen som ska
   förbättras, inte texten som ska växa.
3. **Aldrig påhittade siffror.** Simulatorn är REN ARITMETIK på
   besökarens egna tal (`floor(underlag × andel/100)` → timmar →
   kronor). Ingen kurva — kurvor antyder empiri som inte finns (v7
   ersatte kurvan med tre utfallskort). Utfallet märks alltid
   "Räkneexempel — bygger på era antaganden."
4. **Antaganden är öppna, redovisade och avgränsade.** Simulatorns tre
   antaganden ligger i en öppen "Justera antaganden"-utfällning med
   redovisade defaults och hårda intervall (andel rutin 50 %, 0–100;
   minuter/underlag 5, 1–60; timkostnad 700 kr, 100–3 000). Baslinjen
   står som stilla förutsättning.
5. **Kvittensen är verklig.** Väntelistans reg-id är de första åtta
   tecknen av lead-radens faktiska databas-id ur API-svaret;
   mottagningstiden är verklig klocka. NrTicker rullar som väntesignal
   men landar aldrig ett påhittat tal.
6. **Exempeldata märks som exempeldata.** Synlig badge i scenens
   rubrikrad, exempelbolagen heter "… Exempel AB", och även
   aria-beskrivningen inleder med "Produktscen med exempeldata".
7. **Social proof renderas först när den är sann.** LogotypRad och
   testimonials är byggda men monteras INTE förrän riktiga kunder
   finns. Rubriken "Byråer som kör grundbok" ska inte vagas ur —
   spärren är att den renderas först när påståendet är sant.
8. **Autonomi visas genom flödet, aldrig annonseras.** Inga
   autonomi-adjektiv ("automatiskt", "AI-drivet"). Kedje-scenen växlar
   två cykler: människans attest får knapptryck och grön stämpel;
   rutinen bokförs stilla — ingen knapp, dämpad stämpel
   (`data-ton="stilla"`), policyraden "inom er policy — bokförs".
   Kontrasten mellan tonlägena ÄR berättelsen. Noten påminner om
   ansvaret: "loggas som policybeslut — rättas alltid av människa".
9. **Kontroll formuleras som mekanism, inte löfte.** Varje
   förtroendemening namnger sin mekanik ("Varje beslut loggas med
   hash, identitet och lagrum — huvudboken är append-only");
   arkitekturfigurens poänger sitter som etiketter PÅ mekaniken.
10. **Ärlig live/kommande-märkning.** Status är en typad egenskap i
    datan (`'live' | 'kommande'`); kommande dämpas visuellt och får
    ingen animation. Live-copy i presens-mekanik; kommande-copy i
    plan-form. Kanalstatus graderas öppet ("klistra in i dag, fler
    kanaler på väg").
11. **Värderamen: rutintid frigörs till rådgivning — aldrig
    ersättning.** "Hanteras av er policy", "Timmar frigjorda".
    Formuleringar där AI "ersätter" eller "tar över" är förbjudna.
12. **Tilltalet är ni/er — byrån äger allt.** "era underlag", "er
    policy", "Ni har sista ordet". Systemet är agerande verktyg;
    ägandet ligger grammatiskt hos läsaren.
13. **Inga emoji-ikoner.** All ikonografi är geometriska inline-SVG:er
    i systemets formspråk: 40×40, viewBox 48, strokeWidth 1.5, rx 3,
    färg via tokens, max EN blå detalj per ikon.

## 8. Kända skulder i kanon (publika ytan — städlista)

Inget av detta är prejudikat; åtgärdas löpande eller i D2:

- Inline-radier utan tokenmatchning: sim-/bento-kort `borderRadius 15`
  (≠ `--r-lg` 14 — hero-scenen har 14, 1px-inkonsekvens), ikonplatta
  12; gap 10 / padding 22 / negativa marginaler utanför `--sp`-skalan.
- Etikettvikt-drift: AttestSimulators `etikettStil` och LogotypRadens
  rubrik har 500 (kanon: 600); spärrningen spretar 0.06–0.14em.
  Kandidat: EN delad etikettstil.
- `rutTransition` hårdkodar `"background-color 200ms ease"` — 200 ms =
  `--dur-med` men `ease` ≠ `--ease-out`.
- Två fokusmanér för inputs: kontakt-fälten (border + 3px mjuk ring
  `rgba(37,99,235,0.18)`) vs simulatorns nummerfält (1px state-driven
  ring, `outline: none`). Välj ett; tokenisera blå-alfan
  (`--fokus-ring`-kandidat).
- Blå-deriverade rgba-literaler utan token: fokusringen,
  sidfotsgradienten (0.16), trygghetsfläckarna (0.1/0.12).
- `.scen-paus` (knapptext) och `.sajt-fot .upphov` (copyright) sätts i
  mono — bryter mot monoregeln i kanon-CSS:en själv.
- `.cta`/`.topp-cta`/`.kontakt-skicka` saknar `:focus-visible`-stil
  (UA-default-ring) — knappfokus-luckan är systemisk, fixas som
  gemensamt mönster.
- Easing-kurvan `[0.22,1,0.36,1]` i tre TS-kopior — exportera en delad
  konstant.
- HeroPixlars sex opacitetsnivåer (0.04–0.16) är oformaliserade
  identitetsvärden — kandidat för namngivna konstanter.
- DESIGN-BRIEF v4 §Struktur p.3 nämner fortfarande "kurva" — v7 tog
  bort kurvan medvetet; briefen bör uppdateras vid nästa revision.

## 9. Audit inför arbetsyte-passet (D2) — ÅTGÄRDAS INTE nu

*Ögonblicksbild 2026-07-14 mot kanon ovan. Radhänvisningar avser
dagens filer.*

### Gemensamt (globals.css delas av admin, byra, operator)

- **Hela arbetsytelagret står på studio-skinnet** — bytet är
  systemiskt, inte radvis. byra.css/operator.css dubbeldefinierar
  inget (rätt mekanik, fel skin): `--bg/--fg/--accent/--border/--success`
  resolvar till varm papper `#F7F1E8` / terracotta `#B0532E` /
  varmgrön `#4E7A4A`. Kärnåtgärd i D2 är på skin-nivå (mappa
  grammatik-slots → grundbok-värden eller scopa om) — då försvinner
  majoriteten av färg-/skuggavvikelserna i ett slag. Beslut krävs:
  flytta globals-basen för alla arbetsytor samtidigt, eller låta varje
  yta scopa sig själv (publik-mönstret).
- Det en omskinning INTE löser (kräver CSS-ändringar): serif som
  bärande rubrikfont (`.steg-titel`/`.steg-nr`/`.wordmark` 34px),
  mono-chips för löptext (`.chip`), etikettvikter 400/500 (kanon 600),
  kort utan skugga, reduced-motion-block saknas helt, inputs 13–14px
  (iOS-zoom), kontrastbrott `--fg-subtle` `#9A8B76` på varm papper
  ≈ 2,9:1 (under AA) för all sekundärtext, mono-kedjan (IBM Plex Mono)
  inte scopad till arbetsytorna — siffror/hash renderas i systemmono.
- Basstorlek: globals body 15px vs publika ytans 16px — ta ställning i
  D2. Maxbredd: 980px (arv) vs publika 1120px — beslutas mot
  `docs/design-referens/arbetsyta/`.

### /byra (byra.css + byra/page.tsx)

- Terracotta läcker överallt: attest-knappen `button.godkann`
  (produktens juridiska poäng!) är `#B0532E`, aktiv fliks underkant,
  antal-pill, checkboxar, rättelse-tagg, steg-nr, ordmärkets em,
  fokusringar (`--ring`).
- `button.primar` (Tolka/Fråga/Spara) är varm brunsvart `#221A12` —
  kanon: blå CTA.
- Chattbubblan `.bubbla.konsult` varm beige `#EBE0CF` — kanon: isblått.
- Flaggor/markörer i amber `#B07A1E` på varm sänka — kanonpalett
  saknar warning; medvetet beslut krävs i D2.
- Typografi: `.steg-titel` serif 22px bär alla flikrubriker;
  `.policy-namn` serif 19px; `.bokford .stor` serif 20px;
  verifikationsnumret (V1, V2 …) i SERIF 18px — dubbelfel, kanon är
  mono (jfr publik `.ver-nr` mono 700). `.chip` (mono) bär löptext:
  modulnamn, klientnamn, "policybeslut", skill@version. Intagets
  textarea mono 13px = kvitto-manér utanför kedje-scenen. Etiketter
  400/500 med 0.04em.
- Kort: `.steg`/`.ko-kort`/`.verifikation` utan skugga på varm yta;
  `.verifikation`-blocket duplicerat byra.css ↔ globals.css
  (städtillfälle).
- Spacing: mikromått utanför skalan (1px 7px, 2px 8px, 3px 10px).
- A11y: `window.prompt` för avvisningsmotivering (ostylat,
  skärmläsarfientligt — attestkön har redan tillgängligt inline-mönster
  för samma sak); inputs 13–14px; kontrastbrotten ovan.
- Berättar: konfidens i två skalor på samma yta ("92 %" i kön/chatten,
  "0.92" i förslags-chipen) — välj en; demo-datumknapparna
  "15 mars/8 juli 2026" är omärkt demo-regi (märk som exempel);
  engelsk säkerhetsjargong i steg-not ("untrusted input …") annonserar
  det injektionsflaggan redan visar.
- **Bevara i ombyggnaden**: mobilhanteringen (skrollbara flikar,
  full-bredds attestknapp <600px, overflow-x på verifikationskort),
  aria-labels på sifferinputs, htmlFor-kopplade checkboxar,
  401-hanteringen, attest-språket ("att attestera", aldrig
  "proposals"). Tre kanonregler hålls redan: ingen glass, inget
  kvitto-manér (utom textarean), inga påhittade siffror.

### /operator (operator.css + operator/page.tsx)

- Samma systemiska studio-skin (varma ytor, terracotta fokus/checkbox/
  ordmärkes-em, `button.primar` brunsvart för "Provisionera agent",
  varm grön/röd/amber).
- `.bokford` (grön statuskant) återanvänds som container för
  nyckel-avslöjandet — grönt på något som inte är status: bryter
  "grönt ENDAST status".
- Typografi: sektionsrubriker i serif 22px; hälsokortens VÄRDEN (rena
  siffror + tidsstämpel) i serif 28px — dubbelfel, ska vara mono;
  scope-chips i mono (löptext); etiketter 400/500.
- Kort: `.halsa-kort` radie `--r-md` (10px) mot kortnivån `--r-lg`;
  ingen skugga.
- A11y (allvarligast på denna yta): bolagsval via `onClick` på `<tr>`
  utan tabIndex/role/tangentbordshantering — hela agent-sektionen
  onåbar utan mus; ingen rubrikhierarki alls (h1–h6 saknas, allt är
  div/span); nyckelvarningen "kopiera nu …" 13px amber ≈ 3,7:1 (under
  AA); inputs 14px; kontrastbrott på all tertiärtext.
- Sju inline-styles i JSX inkl. `style={{ all: "unset" }}` på
  checkbox-labels (nollställer även fokus-stil).
- Berättar: föredömligt — endast driftaggregat (aldrig belopp/
  motparter), ärliga tomlägen, ärlig nyckel-copy, inga påhittade
  siffror. Inga berättar-avvikelser.

### /login (login.css + login/page.tsx)

*Ligger redan i vit/blå (v5.1) och konsumerar centralkällan — kvar är
kantfall, inte ett systemiskt byte:*

- Ordmärket ärvs oscopat från globals studio-basregel (serif/34px/
  tracking från `.wordmark` i globals) — ändras globals i D2 ändras
  login osynligt. Kandidat: scopa login fullt ut.
- Isblått som HELSIDESYTA (fixed `::before`) — kanon definierar
  `--yta-is` som sektionsband på kallvit bas; behöver beslutas som
  mönster för auth-ytor i D2. Under lagret ligger dessutom studio-varm
  body-bakgrund som kan blinka fram vid overscroll/rubber-band i
  Safari.
- `<code>grundbok-dev</code>` träffas av ingen CSS-regel →
  UA-default-mono i stället för IBM Plex Mono (som laddas men aldrig
  konsumeras på ytan); ett lösenord ligger dessutom utanför monots
  tillåtna lista.
- Kortreceptet: `.dokument` = `--r-lg` + `--skugga-lyft`; närmaste
  kanon-motsvarighet (väntelistans formulärkort) = `--r-xl` +
  `--skugga-lyft`.
- `padding-top: 10vh` utanför skalan; övriga mått ärvs från
  studio-basens main-regel.
- `.login-knapp` och ordmärkeslänken saknar `:focus-visible` (samma
  systemiska lucka som publik).
- Inget reduced-motion-block (låg allvarlighet — endast
  färg/skugg-transitions).
- Dev-noten renderas OVILLKORLIGT med riktiga uppgifter
  (e-post + lösenord) — måste miljö-villkoras före deploy
  (deploy-checklista, utanför design).
- I övrigt konform: AA-kontraster, 16px-inputs, etiketter exakt enligt
  mönstret, ärlig dev-märkning, "Loggar in …"-tillstånd, grönt används
  inte alls.
