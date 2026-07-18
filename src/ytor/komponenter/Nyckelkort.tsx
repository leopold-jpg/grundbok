"use client";

import { useState } from "react";

// Nyckelkortet (WP27/WP28) — engångsavslöjandet av en agentnyckel.
// Blå markeringskant (information om en engångshändelse, INTE grönt —
// kanon §2), varningen i --varning, klartexten i mono med user-select:
// all. Nyckeln finns bara i detta svar; endast hashen lagras.

export function Nyckelkort({ rubrik, nyckel }: { rubrik: string; nyckel: string }) {
  const [kopierad, setKopierad] = useState(false);
  return (
    <div className="nyckelkort" role="status">
      {rubrik} —{" "}
      <span className="nyckel-varning">
        kopiera nu, den visas aldrig igen (endast hashen lagras):
      </span>
      <div className="nyckel-klartext">{nyckel}</div>
      <button
        className="nyckel-kopiera"
        onClick={async () => {
          await navigator.clipboard.writeText(nyckel);
          setKopierad(true);
        }}
      >
        Kopiera nyckeln
      </button>
      {kopierad && <span className="nyckel-kopierad">kopierad</span>}
    </div>
  );
}
