"use client";

import { useState } from "react";

// Nyckelkortet (WP27/WP28) — engångsavslöjandet av en agentnyckel.
// Blå markeringskant (information om en engångshändelse, INTE grönt —
// kanon §2), varningen i --varning, klartexten i mono med user-select:
// all. Nyckeln finns bara i detta svar; endast hashen lagras.

export function Nyckelkort({ rubrik, nyckel }: { rubrik: string; nyckel: string }) {
  const [kopierad, setKopierad] = useState<"" | "ja" | "nej">("");
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
          // Klippbordet kan saknas (http-host) eller nekas — tyst
          // misslyckande vore farligt just här, nyckeln visas aldrig igen.
          try {
            await navigator.clipboard.writeText(nyckel);
            setKopierad("ja");
          } catch {
            setKopierad("nej");
          }
        }}
      >
        Kopiera nyckeln
      </button>
      {kopierad === "ja" && <span className="nyckel-kopierad">kopierad</span>}
      {kopierad === "nej" && (
        <span className="nyckel-varning">
          {" "}
          kunde inte nå klippbordet — markera texten och kopiera manuellt
        </span>
      )}
    </div>
  );
}
