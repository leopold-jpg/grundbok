# DESIGN-INSPO v2 — vit/blå SaaS-produkt (ersätter v1)

Läses med DESIGN-BRIEF och bilderna i docs/design-referens/.
Huvudreferens för STRUKTUR och känsla: taxxa.ai — skärmdumpar av
deras sektioner ligger i docs/design-referens/saas/. Regel per lån:
**mönster och struktur får lånas, exakta utseenden översätts alltid
till vårt färgsystem (CSS-variabler) — aldrig rå Tailwind-kopiering.**

## Strukturen att sikta på (taxxa-mönstret)

1. Hero: rubrik + underrubrik + CTA, och PRODUKTEN direkt under som
   interaktiv scen (vår kedje-scen — behålls, omfärgas).
2. Social proof-rad (logotyper) — VI HAR INGA ÄN: bygg platsen som
   dold komponent, aktiveras när Mats byrå är live. Aldrig påhittade.
3. Feature-sektioner i bento/panel-grid med små levande detaljer
   per kort (våra: simulator, moduler, arkitekturfigur).
4. Säkerhet/förtroende som egen mörk eller ljus premium-sektion.
5. CTA-sektion + väntelistan.

## Komponentbibliotek (mönsterkällor, översätt till våra tokens)

- **Magic UI** — github.com/magicuidesign/magicui. BYGGD för exakt
  det här: animerade SaaS-landningskomponenter. Relevanta mönster:
  number ticker (väntelistans räknare), animated beam (dataflöde i
  arkitekturfiguren), bento grid (moduler/features), marquee
  (framtida logotyprad), shimmer på CTA.
- **Aceternity UI** — ui.aceternity.com. Hero-effekter och kort med
  djup; låna återhållsamt — max EN "wow"-effekt per sida, annars
  blir det mässmonter.
- **shadcn/ui** — github.com/shadcn-ui/ui. Formulär, dialoger,
  fokus/aria-mönster för väntelistan och login.
- **HyperUI** — sektionsskelett/responsivitet som förut.

Arbetssätt: läs komponentens källkod, förstå mönstret, återimplementera
mot våra CSS-variabler och Motion-setup. Vi tar INTE in Tailwind som
beroende för detta.

## Rörelse (uppgraderad ambition)

Scroll-drivna avslöjanden med lite mer självförtroende än v1:
staggered reveals, number tickers, animated beams i figurer. Fortsatt:
prefers-reduced-motion respekteras överallt, pausknapp på loopar,
aldrig scroll-hijacking.

## Vad som fortfarande är förbjudet

Påhittade siffror/kunder/citat, gradient-orgier (EN subtil blå
gradient på mörk yta är ok), emoji-ikoner, mer än en wow-effekt per
vy, Tailwind-klasser i vårt CSS-system.
