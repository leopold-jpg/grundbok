import { IBM_Plex_Mono } from "next/font/google";

// Publika sajtens typsnittstillägg. Brief v3: grotesken (Inter, laddad
// i layout.tsx) bär rubrikerna; serifen är varumärkeskrydda och är
// Instrument Serif — samma familj som layouten redan self-hostar via
// --font-app-serif, så ingen extra laddning behövs här. IBM Plex Mono
// för siffror/konton/lagrum/markerade fraser (kvitto-känslan).
// Typografiprovet bakom valet: docs/design-referens/typografiprov/.

export const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-publik-mono",
});
