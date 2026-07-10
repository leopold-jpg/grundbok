import { Fraunces, IBM_Plex_Mono } from "next/font/google";

// Publika sajtens typografi (DESIGN-INSPO): Fraunces som display-serif
// (variabel vikt + optisk storlek — didone-tyngden i storgrad), IBM
// Plex Mono för siffror/konton/lagrum. Self-hostade via next/font,
// scopade till publika ytan och /login via CSS-variabler — layout.tsx
// (delad med /byra och /operator) rörs inte. Typografiprovet som låg
// till grund för valet: docs/design-referens/typografiprov/.

export const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-publik-serif",
});

export const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-publik-mono",
});
