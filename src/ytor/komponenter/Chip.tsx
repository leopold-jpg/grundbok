import type { ReactNode } from "react";

// Chip (WP28) — delad av /byra och /operator. Sans-etikett som default;
// `tal` för VERKLIGA värden ur systemet (hash, belopp, saldo — mono,
// kanon §3), `varning` för statuschips (ENDAST status, kanon §2).

export function Chip({
  tal,
  varning,
  title,
  children,
}: {
  tal?: boolean;
  varning?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`chip${tal ? " tal" : ""}${varning ? " chip-varning" : ""}`}
      title={title}
    >
      {children}
    </span>
  );
}
