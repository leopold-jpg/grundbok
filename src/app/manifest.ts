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
    scope: "/app",
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#FFFFFF",
    icons: [
      { src: "/appicon-paper-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/appicon-paper-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
