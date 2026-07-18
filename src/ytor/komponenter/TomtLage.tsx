import type { ReactNode } from "react";

// Tomt tillstånd (WP28) — delad av båda ytorna. Lugnt och ärligt:
// säger vad som saknas och varifrån det kommer, aldrig en ursäkt.

export function TomtLage({ children }: { children: ReactNode }) {
  return <p className="tomt-lage">{children}</p>;
}
