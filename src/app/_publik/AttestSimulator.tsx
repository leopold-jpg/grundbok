"use client";

/**
 * AttestSimulator v2 — "frigör timmar till rådgivning"-simulator för publika sajten.
 *
 * Props-kontrakt:
 *   spelar: boolean — integratören sätter denna till `mounted && !prefers-reduced-motion`.
 *     Servern renderar alltid spelar=false och komponenten renderar identiskt på server
 *     och första klientrendering: all state har statiska defaults (100 underlag,
 *     50 % rutin, 5 min/underlag, 700 kr/h) och inga effekter muterar initial DOM.
 *     `spelar` styr ENBART om kvadraternas färgbyte får en mjuk CSS-transition
 *     (200 ms) eller sker direkt.
 *
 * Klassnamn som integratören kan styla vidare i publik.css (komponenten skriver
 * ingen egen CSS — baseline-utseendet ligger i inline styles):
 *   .sim-reglage — range-inputen "Underlag per månad" (accentColor: var(--bla) inline).
 *   .sim-falt   — de tre antagande-fälten (type="number"); boxad kant och blå
 *                 fokusring finns redan inline via fokus-state.
 *
 * Allt som visas är ren aritmetik på besökarens egna antaganden — inga hårdkodade
 * timbesparingar, procentsatser eller kundpåståenden. Ramen är att rutintid
 * frigörs till rådgivning, aldrig att någon ersätts.
 */

import { useMemo, useState, type CSSProperties } from "react";

type AttestSimulatorProps = {
  /** true först när klienten är monterad och användaren inte föredrar reducerad rörelse. */
  spelar: boolean;
};

const SANS = "var(--font-sans)";
const MONO = "var(--font-mono)";

/** Grotesk small-caps-etikett — etiketter sätts aldrig i mono. */
const etikettStil: CSSProperties = {
  fontFamily: SANS,
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--ink-svag)",
};

/** Synligt siffervärde intill en etikett. */
const vardeStil: CSSProperties = {
  fontFamily: MONO,
  fontSize: 13,
  fontVariantNumeric: "tabular-nums",
  color: "var(--ink)",
};

/** Tolkar ett fälts text som tal och klämmer in det i [min, max]; ogiltigt → min. */
function klamp(text: string, min: number, max: number): number {
  const tal = Number(text);
  if (!Number.isFinite(tal)) return min;
  return Math.min(max, Math.max(min, tal));
}

export default function AttestSimulator({ spelar }: AttestSimulatorProps) {
  const [underlag, setUnderlag] = useState(100);
  const [andelText, setAndelText] = useState("50");
  const [minuterText, setMinuterText] = useState("5");
  const [timkostnadText, setTimkostnadText] = useState("700");
  const [fokusFalt, setFokusFalt] = useState<string | null>(null);

  // Antaganden, inklämda i sina tillåtna intervall.
  const andel = klamp(andelText, 0, 100);
  const minuter = klamp(minuterText, 1, 60);
  const timkostnad = klamp(timkostnadText, 100, 3000);

  // Ren aritmetik av inmatningarna — inget hårdkodat.
  const hanterasAvPolicy = Math.floor((underlag * andel) / 100);
  const kraverAttest = underlag - hanterasAvPolicy;
  const timmar = (hanterasAvPolicy * minuter) / 60;
  const kronor = Math.round(timmar * timkostnad);

  const timmarText = timmar.toLocaleString("sv-SE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const kronorText = kronor.toLocaleString("sv-SE");

  const rutTransition = spelar
    ? "background-color 200ms ease, border-color 200ms ease"
    : "none";

  // Rutnät: en kvadrat per underlag. Attest-delen (blå) läses först,
  // policy-delen (dämpad) sist.
  const rutor = useMemo(
    () =>
      Array.from({ length: underlag }, (_, i) => {
        const arPolicy = i >= kraverAttest;
        return (
          <div
            key={i}
            style={{
              width: 13,
              height: 13,
              borderRadius: 3,
              boxSizing: "border-box",
              border: "1px solid",
              borderColor: arPolicy ? "var(--linje)" : "var(--bla)",
              backgroundColor: arPolicy ? "var(--yta-is)" : "var(--bla)",
              transition: rutTransition,
            }}
          />
        );
      }),
    [underlag, kraverAttest, rutTransition]
  );

  const falt: Array<{
    id: string;
    etikett: string;
    min: number;
    max: number;
    varde: string;
    sattVarde: (v: string) => void;
    klampat: number;
  }> = [
    {
      id: "sim-andel",
      etikett: "Andel rutin (%)",
      min: 0,
      max: 100,
      varde: andelText,
      sattVarde: setAndelText,
      klampat: andel,
    },
    {
      id: "sim-minuter",
      etikett: "Minuter per underlag",
      min: 1,
      max: 60,
      varde: minuterText,
      sattVarde: setMinuterText,
      klampat: minuter,
    },
    {
      id: "sim-timkostnad",
      etikett: "Timkostnad (kr)",
      min: 100,
      max: 3000,
      varde: timkostnadText,
      sattVarde: setTimkostnadText,
      klampat: timkostnad,
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Reglage — ett enda: volymen underlag */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
          <span style={vardeStil}>{underlag.toLocaleString("sv-SE")}</span>
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

      {/* Antaganden — öppna och justerbara, grupperade under rubrikraden */}
      <div
        role="group"
        aria-labelledby="sim-antaganden-rubrik"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <span id="sim-antaganden-rubrik" style={etikettStil}>
          Antaganden — justera efter er byrå
        </span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {falt.map((f) => {
            const harFokus = fokusFalt === f.id;
            return (
              <div
                key={f.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  flex: "0 1 auto",
                }}
              >
                <label htmlFor={f.id} style={etikettStil}>
                  {f.etikett}
                </label>
                <input
                  id={f.id}
                  className="sim-falt"
                  type="number"
                  min={f.min}
                  max={f.max}
                  step={1}
                  value={f.varde}
                  onChange={(e) => f.sattVarde(e.target.value)}
                  onFocus={() => setFokusFalt(f.id)}
                  onBlur={() => {
                    setFokusFalt(null);
                    f.sattVarde(String(f.klampat));
                  }}
                  style={{
                    width: 96,
                    boxSizing: "border-box",
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid",
                    borderColor: harFokus
                      ? "var(--bla)"
                      : "var(--linje-stark)",
                    boxShadow: harFokus
                      ? "0 0 0 1px var(--bla)"
                      : "none",
                    outline: "none",
                    backgroundColor: "var(--yta)",
                    fontFamily: MONO,
                    fontSize: 13,
                    fontVariantNumeric: "tabular-nums",
                    color: "var(--ink)",
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Rutnät — dekorativ visualisering av samma tal som utfallsraden */}
      <div
        aria-hidden="true"
        style={{ display: "flex", flexWrap: "wrap", gap: 4 }}
      >
        {rutor}
      </div>

      {/* Utfall — ren aritmetik av besökarens antaganden */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <output
          htmlFor="sim-underlag sim-andel sim-minuter sim-timkostnad"
          aria-live="polite"
          style={{
            fontFamily: SANS,
            fontSize: 14,
            lineHeight: 1.6,
            color: "var(--ink)",
          }}
        >
          <span style={vardeStil}>
            {hanterasAvPolicy.toLocaleString("sv-SE")}
          </span>{" "}
          av{" "}
          <span style={vardeStil}>{underlag.toLocaleString("sv-SE")}</span>{" "}
          hanteras av er policy —{" "}
          <span style={vardeStil}>~{timmarText}</span> timmar per månad till
          rådgivning i stället, motsvarande{" "}
          <span style={vardeStil}>~{kronorText}</span> kr.
        </output>
        <p
          style={{
            margin: 0,
            fontFamily: SANS,
            fontSize: 12,
            color: "var(--ink-svag)",
          }}
        >
          Räkneexempel — bygger på era antaganden.
        </p>
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 20,
          alignItems: "center",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
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
          <span
            style={{ fontFamily: SANS, fontSize: 12, color: "var(--ink-mjuk)" }}
          >
            kräver er attest
          </span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
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
          <span
            style={{ fontFamily: SANS, fontSize: 12, color: "var(--ink-mjuk)" }}
          >
            hanteras av er policy
          </span>
        </span>
      </div>
    </div>
  );
}
