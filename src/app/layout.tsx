import type { Metadata } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import "./globals.css";

// Fonterna self-hostas av next/font — demon är inte beroende av att
// Google Fonts svarar. Studio-skinnet (Gesso) pekar på samma familjer.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-app-sans",
});
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-app-serif",
});

export const metadata: Metadata = {
  title: "grundbok — vertikal skiva",
  description:
    "Kvitto → tolkning → BAS-kontering → konsultgodkännande → bokfört (append-only)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv" className={`${inter.variable} ${instrumentSerif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
