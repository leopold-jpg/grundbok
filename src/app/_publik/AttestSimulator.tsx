"use client";

/**
 * AttestSimulator v3 — "frigör timmar till rådgivning"-simulator för publika sajten.
 *
 * Formen (v7): EN dragbar (underlag/månad) och under den TRE bento-kort som
 * uppdaterar sig själva medan man drar — siffrorna rullar in med samma
 * deterministiska ticker-mönster som RegTicker. Baslinjen "Idag granskas allt
 * manuellt." står som stilla förutsättning ovanför. Antagandena (andel rutin,
 * min/underlag, timkostnad) ligger i en diskret "Justera antaganden"-utfällning
 * med rimliga defaults (50 %, 5 min, 700 kr/h).
 *
 * Props-kontrakt:
 *   spelar: boolean — integratören sätter denna till `mounted && !prefers-reduced-motion`.
 *     Servern renderar alltid spelar=false och komponenten renderar identiskt på
 *     server och första klientrendering: all state har statiska defaults och
 *     TalTicker visar då alltid exakt värde. `spelar` styr ENBART (a) om
 *     siffrorna rullar när ett värde byts (annars byts de direkt) och (b) om
 *     kvadraternas färgbyte får en mjuk CSS-transition.
 *
 * Kvadrat-rutnätet visualiserar samma tal som korten: fyllda blå kvadrater =
 * hanteras av er policy, konturkvadrater = kräver er attest. Policy-delen är
 * fylld (inte urblekt) så att 100 % rutin läses som "fullt hanterat", inte tomt.
 *
 * Klassnamn som integratören kan styla vidare i publik.css (komponenten skriver
 * ingen egen CSS — baseline-utseendet ligger i inline styles):
 *   .sim-reglage    — range-inputen "Underlag per månad".
 *   .sim-kort-grid  — kortens grid (1 kolumn default; kolumner sätts i publik.css).
 *   .sim-kort       — de tre utfallskorten.
 *   .sim-utfallning — <details> runt antagandena (summary-stil i publik.css).
 *   .sim-falt       — de tre antagande-fälten (type="number").
 *
 * Tillgänglighet: kortens siffror är ren text (ingen live-region — rullningen
 * hade spammat uppläsningen); reglagets aria-valuetext bär hela utfallet.
 *
 * Allt som visas är ren aritmetik på besökarens egna antaganden — inga
 * hårdkodade timbesparingar, procentsatser eller kundpåståenden. Ramen är att
 * rutintid frigörs till rådgivning, aldrig att någon ersätts.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useAnimationFrame } from "framer-motion";

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

/* ============================== TalTicker ============================== */
/*
 * RegTicker-mönstret för föränderliga tal: när `varde` byts (och spelar=true)
 * rullar varje siffer-position deterministiskt genom 0–9 (startindex härlett
 * ur positionen — ingen Math.random) och landar på sin riktiga siffra,
 * vänster → höger. Icke-siffror (mellanslag, komma, ~) står stilla. Kort
 * totaltid (~0,3 s) så att rullningen hinner med när man drar i reglaget.
 * spelar=false ⇒ exakt `varde` som statisk text, värdet byts utan animation.
 */

const SIFFROR = "0123456789";
const TAL_RULL = 40; // ms per siffra i rullningen
const TAL_STAGGER = 45; // ms mellan landningar, vänster → höger
const TAL_BAS = 140; // ms rullning innan första siffran landar

function TalTicker({ varde, spelar }: { varde: string; spelar: boolean }) {
  // Infinity = landat (serverns och reduced motion-läget: exakt värde direkt).
  const [tid, setTid] = useState(Number.POSITIVE_INFINITY);
  const tidRef = useRef(Number.POSITIVE_INFINITY);
  const startRef = useRef<number | null>(null);

  const tecken = Array.from(varde);
  const antalSiffror = tecken.filter((t) => SIFFROR.includes(t)).length;
  const total =
    antalSiffror === 0 ? 0 : (antalSiffror - 1) * TAL_STAGGER + TAL_BAS;

  // Nytt värde (eller spelar-flank) ⇒ starta om rullningen. Utan spelar
  // lämnas tid=∞ ⇒ landat ⇒ värdet byts direkt, utan animation.
  useEffect(() => {
    if (!spelar) {
      startRef.current = null;
      tidRef.current = Number.POSITIVE_INFINITY;
      setTid(Number.POSITIVE_INFINITY);
      return;
    }
    startRef.current = null;
    tidRef.current = 0;
    setTid(0);
  }, [varde, spelar]);

  useAnimationFrame((t) => {
    if (!spelar || tidRef.current >= total) return;
    if (startRef.current === null) startRef.current = t;
    const forflutet = Math.min(t - startRef.current, total);
    tidRef.current = forflutet;
    setTid(forflutet);
  });

  let siffPos = 0;
  return (
    <span
      style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "pre" }}
    >
      {tecken.map((riktigt, i) => {
        // Landad siffra kommer ALLTID direkt ur `varde`.
        let visat = riktigt;
        if (SIFFROR.includes(riktigt)) {
          const d = siffPos++;
          const landning = d * TAL_STAGGER + TAL_BAS;
          if (spelar && tid < total && tid < landning) {
            const startIdx = (d * 3 + 7) % SIFFROR.length; // deterministiskt ur positionen
            const steg = Math.floor(Math.max(tid, 0) / TAL_RULL);
            visat = SIFFROR.charAt((startIdx + steg) % SIFFROR.length);
          }
        }
        return <span key={i}>{visat}</span>;
      })}
    </span>
  );
}

/* ============================== simulatorn ============================== */

/** Tolkar ett fälts text som tal och klämmer in det i [min, max]; ogiltigt → min. */
function klamp(text: string, min: number, max: number): number {
  const tal = Number(text);
  if (!Number.isFinite(tal)) return min;
  return Math.min(max, Math.max(min, tal));
}

const kortStil: CSSProperties = {
  background: "var(--kort)",
  border: "1px solid var(--linje)",
  borderRadius: 15,
  boxShadow: "var(--skugga-kort)",
  padding: 20,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  minWidth: 0,
  boxSizing: "border-box",
};

const stortalStil: CSSProperties = {
  fontFamily: MONO,
  fontSize: "clamp(24px, 3vw, 30px)",
  fontVariantNumeric: "tabular-nums",
  lineHeight: 1.1,
  color: "var(--ink)",
  whiteSpace: "nowrap",
};

const enhetStil: CSSProperties = {
  fontFamily: SANS,
  fontSize: 13,
  color: "var(--ink-svag)",
};

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

  // Rutnät: en kvadrat per underlag, samma tal som korten. Policy-delen
  // (fylld blå) läses först — fylld, så att 100 % rutin ser fullt hanterat
  // ut i stället för tomt; attest-delen är kontur.
  const rutor = useMemo(
    () =>
      Array.from({ length: underlag }, (_, i) => {
        const arPolicy = i < hanterasAvPolicy;
        return (
          <div
            key={i}
            style={{
              width: 13,
              height: 13,
              borderRadius: 3,
              boxSizing: "border-box",
              border: "1px solid",
              borderColor: arPolicy ? "var(--bla)" : "var(--linje-stark)",
              backgroundColor: arPolicy ? "var(--bla)" : "var(--kort)",
              transition: rutTransition,
            }}
          />
        );
      }),
    [underlag, hanterasAvPolicy, rutTransition]
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

  const utfallsKort: Array<{ etikett: string; innehall: ReactNode }> = [
    {
      etikett: "Hanteras av er policy",
      innehall: (
        <>
          <TalTicker
            varde={hanterasAvPolicy.toLocaleString("sv-SE")}
            spelar={spelar}
          />{" "}
          <span style={enhetStil}>
            av <TalTicker varde={underlag.toLocaleString("sv-SE")} spelar={spelar} />
          </span>
        </>
      ),
    },
    {
      etikett: "Timmar frigjorda",
      innehall: (
        <>
          ~<TalTicker varde={timmarText} spelar={spelar} />{" "}
          <span style={enhetStil}>h/mån</span>
        </>
      ),
    },
    {
      etikett: "Motsvarande",
      innehall: (
        <>
          ~<TalTicker varde={kronorText} spelar={spelar} />{" "}
          <span style={enhetStil}>kr/mån</span>
        </>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Baslinjen — stilla förutsättning, ingen interaktion */}
      <p
        style={{
          margin: 0,
          fontFamily: SANS,
          fontSize: 13,
          color: "var(--ink-svag)",
        }}
      >
        Idag granskas allt manuellt.
      </p>

      {/* Reglaget — det enda som kräver besökarens hand */}
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
          aria-valuetext={`${underlag} underlag per månad — ${hanterasAvPolicy} hanteras av er policy, cirka ${timmarText} timmar frigjorda, motsvarande cirka ${kronorText} kronor per månad`}
          style={{
            display: "block",
            width: "100%",
            margin: 0,
            accentColor: "var(--bla)",
          }}
        />
      </div>

      {/* Rutnät — dekorativ visualisering av samma tal som korten */}
      <div
        aria-hidden="true"
        style={{ display: "flex", flexWrap: "wrap", gap: 4 }}
      >
        {rutor}
      </div>

      {/* Legend */}
      <div
        aria-hidden="true"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 20,
          alignItems: "center",
          marginTop: -12,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span
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
            hanteras av er policy
          </span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              boxSizing: "border-box",
              border: "1px solid var(--linje-stark)",
              backgroundColor: "var(--kort)",
              flexShrink: 0,
            }}
          />
          <span
            style={{ fontFamily: SANS, fontSize: 12, color: "var(--ink-mjuk)" }}
          >
            kräver er attest
          </span>
        </span>
      </div>

      {/* Utfallskorten — uppdaterar sig själva medan man drar */}
      <div
        className="sim-kort-grid"
        style={{ display: "grid", gap: 16 }}
        // OBS: ingen gridTemplateColumns här — 1 kolumn är grid-default
        // (mobil-fallback); publik.css sätter 3 kolumner vid brytpunkten.
      >
        {utfallsKort.map((k) => (
          <div key={k.etikett} className="sim-kort" style={kortStil}>
            <span style={etikettStil}>{k.etikett}</span>
            <span style={stortalStil}>{k.innehall}</span>
          </div>
        ))}
      </div>

      <p
        style={{
          margin: 0,
          marginTop: -8,
          fontFamily: SANS,
          fontSize: 12,
          color: "var(--ink-svag)",
        }}
      >
        Räkneexempel — bygger på era antaganden.
      </p>

      {/* Antaganden — diskret utfällning med rimliga defaults */}
      <details className="sim-utfallning">
        <summary>Justera antaganden</summary>
        <div
          role="group"
          aria-label="Antaganden"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            paddingTop: 14,
          }}
        >
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
      </details>
    </div>
  );
}
