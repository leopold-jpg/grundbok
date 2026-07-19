import type { Metadata, Viewport } from "next";

// Kundappens segment-metadata (WP22): hemskärmsapp utan App Store.
// Manifestet ligger i src/app/manifest.ts; apple-touch-ikonen är
// D1-märket (favicon-180 → public/apple-touch-icon.png).
export const metadata: Metadata = {
  title: "grundbok",
  description: "Fota kvitton, följ dina underlag och fråga om din bokföring.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "grundbok",
  },
  icons: {
    apple: "/apple-touch-icon.png",
    icon: "/favicon-32.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FFFFFF",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
