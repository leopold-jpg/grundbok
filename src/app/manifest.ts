import type { MetadataRoute } from "next";

// PWA-manifestet (WP22): kundappen installeras från hemskärmen —
// ingen App Store-paketering i v1 (icke-mål). Ikonerna är D1-märket
// (appicon-paper-512 ur docs/brand/, kopierad till public/).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "grundbok — kundapp",
    short_name: "grundbok",
    description: "Fota kvitton, följ dina underlag och fråga om din bokföring.",
    start_url: "/app",
    // Scope "/" så att login-redirecten (utgången session) stannar i
    // appfönstret i stället för att kastas ut i webbläsaren.
    scope: "/",
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#FFFFFF",
    // Ingen maskable-variant: D1-märket har ingen safe zone-marginal —
    // hellre ärlig "any" än ett beskuret märke (BRAND.md: skala aldrig
    // fritt, frizon minst en pixelcell).
    icons: [
      { src: "/appicon-paper-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/appicon-paper-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
