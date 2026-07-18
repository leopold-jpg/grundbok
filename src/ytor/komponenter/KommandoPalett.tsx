"use client";

import { useEffect, useRef, useState } from "react";
import { filtreraKommandon, type Kommando } from "./kommandon";

// Cmd+K-paletten (WP26/WP27) — delad av /byra och /operator. Vilka
// kommandon som finns avgörs av byggKommandon (rollregeln bor där);
// paletten är bara sök + val. Tangentbord: skriv för att filtrera,
// ↑↓ väljer, Enter kör, Escape stänger.

const GRUPPNAMN: Record<Kommando["grupp"], string> = {
  navigera: "Navigera",
  klient: "Klienter",
  motpart: "Motparter",
  bolag: "Klientbolag",
  agent: "Agenter",
  atgard: "Åtgärder",
};

export function KommandoPalett({
  oppen,
  kommandon,
  onVal,
  onStang,
}: {
  oppen: boolean;
  kommandon: Kommando[];
  onVal: (kommando: Kommando) => void;
  onStang: () => void;
}) {
  const [term, setTerm] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (oppen) {
      setTerm("");
      setIndex(0);
    }
  }, [oppen]);

  const traffar = filtreraKommandon(kommandon, term);
  const vald = Math.min(index, Math.max(traffar.length - 1, 0));

  // Håll den valda raden i synfältet när man pilar i en lång lista.
  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [vald, oppen]);

  if (!oppen) return null;

  function kor(k: Kommando | undefined) {
    if (!k) return;
    onVal(k);
    onStang();
  }

  return (
    <div className="kpalett-fond" onClick={onStang} role="presentation">
      <div
        className="kpalett"
        role="dialog"
        aria-modal="true"
        aria-label="Kommandopalett"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="text"
          autoFocus
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex(Math.min(vald + 1, traffar.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex(Math.max(vald - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              kor(traffar[vald]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onStang();
            }
          }}
          placeholder="Skriv för att söka kommando …"
          aria-label="Sök kommando"
          role="combobox"
          aria-expanded="true"
          aria-controls="kpalett-lista"
          aria-activedescendant={traffar[vald] ? `kpalett-${traffar[vald].id}` : undefined}
        />
        {traffar.length === 0 ? (
          <p className="tyst kpalett-tom">Inga kommandon matchar.</p>
        ) : (
          <ul id="kpalett-lista" role="listbox" ref={listRef} aria-label="Kommandon">
            {traffar.map((k, i) => (
              <li
                key={k.id}
                id={`kpalett-${k.id}`}
                role="option"
                aria-selected={i === vald}
                data-vald={i === vald}
                onMouseEnter={() => setIndex(i)}
                onClick={() => kor(k)}
              >
                {(i === 0 || traffar[i - 1].grupp !== k.grupp) && (
                  <span className="kpalett-grupp">{GRUPPNAMN[k.grupp]}</span>
                )}
                <span className="kpalett-rubrik">{k.rubrik}</span>
                {k.detalj && <span className="kpalett-detalj">{k.detalj}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="kpalett-hjalp" aria-hidden="true">
          ↑↓ välj · Enter kör · Esc stäng
        </p>
      </div>
    </div>
  );
}
