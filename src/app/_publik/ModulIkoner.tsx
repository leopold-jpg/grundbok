// Modulernas ikoner (v4 §7) — samma illustrationsspråk som steg-
// panelerna: rundade rektanglar, hårfina linjer, mono-detaljer,
// kvitto-geometri. Statiska, dekorativa (aria-hidden i korten).
// Färger via CSS-variabler från main.publik; rust används som EN
// liten detalj per ikon och tonas bort av kortets kommande-läge.

const bas = {
  fill: "none",
  stroke: "var(--ink)",
  strokeWidth: 1.5,
} as const;

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 48 48"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", width: 40, height: 40 }}
    >
      {children}
    </svg>
  );
}

export function IkonBokforing() {
  return (
    <Svg>
      <rect x="10" y="6" width="28" height="36" rx="3" {...bas} fill="var(--papper-elev)" />
      <line x1="16" y1="15" x2="32" y2="15" stroke="var(--linje-stark)" strokeWidth="1.5" />
      <line x1="16" y1="22" x2="28" y2="22" stroke="var(--ink-svag)" strokeWidth="1.5" />
      <line x1="16" y1="28" x2="28" y2="28" stroke="var(--ink-svag)" strokeWidth="1.5" />
      <rect x="30" y="25.5" width="5" height="5" rx="1" fill="var(--rost)" />
      <line x1="16" y1="35" x2="32" y2="35" stroke="var(--ink)" strokeWidth="1.5" />
    </Svg>
  );
}

export function IkonRadgivning() {
  return (
    <Svg>
      <rect x="7" y="9" width="34" height="24" rx="6" {...bas} fill="var(--papper-elev)" />
      <path d="M 16 33 L 16 40 L 24 33" {...bas} fill="var(--papper-elev)" />
      <text
        x="24"
        y="26"
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="14"
        fill="var(--ink)"
      >
        §
      </text>
    </Svg>
  );
}

export function IkonKundapp() {
  return (
    <Svg>
      <rect x="14" y="5" width="20" height="38" rx="4" {...bas} fill="var(--papper-elev)" />
      <rect x="19" y="12" width="10" height="14" rx="1" fill="none" stroke="var(--ink-svag)" strokeWidth="1.2" />
      <line x1="21" y1="17" x2="27" y2="17" stroke="var(--ink-svag)" strokeWidth="1.2" />
      <line x1="21" y1="21" x2="27" y2="21" stroke="var(--rost)" strokeWidth="1.2" />
      <line x1="21" y1="37" x2="27" y2="37" stroke="var(--ink)" strokeWidth="1.5" />
    </Svg>
  );
}

export function IkonLoner() {
  return (
    <Svg>
      <rect x="7" y="8" width="34" height="32" rx="3" {...bas} fill="var(--papper-elev)" />
      <line x1="7" y1="16" x2="41" y2="16" stroke="var(--linje-stark)" strokeWidth="1.5" />
      <line x1="13" y1="24" x2="24" y2="24" stroke="var(--ink-svag)" strokeWidth="1.5" />
      <line x1="13" y1="31" x2="24" y2="31" stroke="var(--ink-svag)" strokeWidth="1.5" />
      <text
        x="35"
        y="30"
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="9"
        fill="var(--ink)"
      >
        kr
      </text>
    </Svg>
  );
}

export function IkonBokslut() {
  return (
    <Svg>
      <rect x="9" y="7" width="30" height="34" rx="3" {...bas} fill="var(--papper-elev)" />
      <line x1="15" y1="15" x2="33" y2="15" stroke="var(--ink-svag)" strokeWidth="1.5" />
      <line x1="15" y1="21" x2="33" y2="21" stroke="var(--ink-svag)" strokeWidth="1.5" />
      <line x1="15" y1="27" x2="33" y2="27" stroke="var(--ink-svag)" strokeWidth="1.5" />
      <rect x="15" y="31" width="7" height="6" rx="1" fill="none" stroke="var(--ink)" strokeWidth="1.5" />
      <path d="M 17 34 L 18.5 35.5 L 21 32.5" fill="none" stroke="var(--ink)" strokeWidth="1.5" />
    </Svg>
  );
}

export function IkonSkatt() {
  return (
    <Svg>
      <rect x="8" y="8" width="32" height="32" rx="16" {...bas} fill="var(--papper-elev)" />
      <text
        x="24"
        y="30"
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="15"
        fill="var(--ink)"
      >
        §
      </text>
    </Svg>
  );
}
