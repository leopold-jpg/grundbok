"use client";

/**
 * AttestSimulator — interaktiv "attesthögen krymper"-simulator för publika sajten.
 *
 * Props-kontrakt:
 *   spelar: boolean — integratören sätter denna till `mounted && !prefers-reduced-motion`.
 *     Servern renderar alltid spelar=false. Komponenten renderar identiskt på server
 *     och första klientrendering: all state har statiska defaults (100 underlag, 50 % rutin),
 *     inga effekter muterar initial DOM. `spelar` styr ENBART om kvadraternas färgbyte
 *     får en mjuk CSS-transition (200 ms) eller sker direkt.
 *
 * Klassnamn som integratören stylar i publik.css (komponenten skriver ingen CSS själv):
 *   .sim-reglage — de två range-inputarna (hover/fokusring, ev. thumb-styling).
 *     Baseline-utseende finns redan via inline `accentColor: var(--bla)`.
 *
 * Allt som visas är ren aritmetik på besökarens reglagevärden — inga hårdkodade
 * procentsatser, timbesparingar eller kundpåståenden.
 */

import { useMemo, useState, type CSSProperties } from "react";

type AttestSimulatorProps = {
  /** true först när klienten är monterad och användaren inte föredrar reducerad rörelse. */
  spelar: boolean;
};

const MONO = "var(--font-mono)";

const etikettStil: CSSProperties = {
  fontFamily: MONO,
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--ink-svag)",
};

const vardeStil: CSSProperties = {
  fontFamily: MONO,
  fontSize: 13,
  fontVariantNumeric: "tabular-nums",
  color: "var(--ink)",
};

export default function AttestSimulator({ spelar }: AttestSimulatorProps) {
  const [underlag, setUnderlag] = useState(100);
  const [rutin, setRutin] = useState(50);

  // Ren aritmetik: så många bokförs av policyn, resten kräver attest.
  const bokforsSjalv = Math.floor((underlag * rutin) / 100);
  const kraverAttest = underlag - bokforsSjalv;

  const rutTransition = spelar
    ? "background-color 200ms ease, border-color 200ms ease"
    : "none";

  // Rutnät: en kvadrat per underlag. Attest-högen (rost) först, rutin (dämpad) sist.
  const rutor = useMemo(
    () =>
      Array.from({ length: underlag }, (_, i) => {
        const arRutin = i >= kraverAttest;
        return (
          <div
            key={i}
            style={{
              width: 13,
              height: 13,
              borderRadius: 3,
              boxSizing: "border-box",
              border: "1px solid",
              borderColor: arRutin ? "var(--linje)" : "var(--bla)",
              backgroundColor: arRutin ? "var(--yta-is)" : "var(--bla)",
              transition: rutTransition,
            }}
          />
        );
      }),
    [underlag, kraverAttest, rutTransition]
  );

  // Kurva: från 100 % (alla kräver attest) ner till besökarens attest-nivå (1 − andel rutin).
  const yTopp = 10; // y-koordinat för 100 %
  const yBas = 100; // y-koordinat för 0 % (baslinjen)
  const attestNiva = (100 - rutin) / 100;
  const ySlut = yBas - attestNiva * (yBas - yTopp);
  const kurvaD = `M 10 ${yTopp} C 220 ${yTopp}, 340 ${ySlut}, 550 ${ySlut}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Reglage */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
        <div
          style={{
            flex: "1 1 220px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
            }}
          >
            <label htmlFor="sim-underlag" style={etikettStil}>
              Underlag per månad
            </label>
            <span style={vardeStil}>{underlag}</span>
          </div>
          <input
            id="sim-underlag"
            className="sim-reglage"
            type="range"
            min={20}
            max={300}
            step={20}
            value={underlag}
            onChange={(e) => setUnderlag(Number(e.target.value))}
            aria-valuetext={`${underlag} underlag per månad`}
            style={{
              display: "block",
              width: "100%",
              margin: 0,
              accentColor: "var(--bla)",
            }}
          />
        </div>

        <div
          style={{
            flex: "1 1 220px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
            }}
          >
            <label htmlFor="sim-rutin" style={etikettStil}>
              Andel rutin (inom er policy)
            </label>
            <span style={vardeStil}>{rutin} %</span>
          </div>
          <input
            id="sim-rutin"
            className="sim-reglage"
            type="range"
            min={0}
            max={100}
            step={5}
            value={rutin}
            onChange={(e) => setRutin(Number(e.target.value))}
            aria-valuetext={`${rutin} procent rutin`}
            style={{
              display: "block",
              width: "100%",
              margin: 0,
              accentColor: "var(--bla)",
            }}
          />
        </div>
      </div>

      {/* Rutnät — dekorativ visualisering av samma tal som resultatraden */}
      <div
        aria-hidden="true"
        style={{ display: "flex", flexWrap: "wrap", gap: 4 }}
      >
        {rutor}
      </div>

      {/* Resultatrad — ren aritmetik av inmatningen */}
      <output
        htmlFor="sim-underlag sim-rutin"
        style={{
          fontFamily: MONO,
          fontSize: 13,
          fontVariantNumeric: "tabular-nums",
          color: "var(--ink)",
        }}
      >
        {bokforsSjalv} av {underlag} bokförs av er policy · {kraverAttest}{" "}
        kräver er attest
      </output>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 20,
          alignItems: "center",
        }}
      >
        <span
          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              backgroundColor: "var(--bla)",
              flexShrink: 0,
            }}
          />
          <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--ink-mjuk)" }}>
            kräver er attest
          </span>
        </span>
        <span
          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              boxSizing: "border-box",
              border: "1px solid var(--linje)",
              backgroundColor: "var(--yta-is)",
              flexShrink: 0,
            }}
          />
          <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--ink-mjuk)" }}>
            bokförs själv
          </span>
        </span>
      </div>

      {/* Kurva — illustration av samma attest-nivå över tid */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <svg
          viewBox="0 0 560 120"
          aria-hidden="true"
          style={{ display: "block", width: "100%", height: "auto" }}
        >
          {/* Hårfin baslinje (0 %) */}
          <line
            x1={10}
            y1={yBas}
            x2={550}
            y2={yBas}
            stroke="var(--linje-stark)"
            strokeWidth={1}
          />
          {/* Kurva från 100 % ner till attest-nivån */}
          <path
            d={kurvaD}
            fill="none"
            stroke="var(--bla)"
            strokeWidth={1.5}
          />
        </svg>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
            fontFamily: MONO,
            fontSize: 11,
            color: "var(--ink-svag)",
          }}
        >
          <span>
            andel som kräver attest — illustration, er policy avgör takten
          </span>
          <span>tid →</span>
        </div>
      </div>
    </div>
  );
}
