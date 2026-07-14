"use client";

// BentoModuler — modulsektionen som bento-grid (publika sajten, vit/blå-systemet).
//
// Props-kontrakt:
//   <BentoModuler spelar={boolean} />
//   - spelar=false (serverns läge): statiskt, komplett renderat — inga
//     animationer. Samma DOM som spelande läge; endast attributvärden skiljer.
//   - spelar=true: de två live-kortens ikoner får en lugn loopande
//     mikroanimation (6–7 s, endast transform/opacity/pathLength,
//     framer-motion-keyframes). Ingen Math.random/Date.now.
//
// Klassnamn som integratören stylar i publik.css:
//   .bento-grid       — wrappern. Basen sätts inline som display:grid + gap,
//                       MEN gridTemplateColumns sätts avsiktligt INTE inline
//                       (grid utan template = 1 kolumn, dvs. mobil-fallbacken),
//                       så publik.css kan ta över utan !important:
//                         @media (min-width: 680px) { .bento-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
//                         @media (min-width: 980px) { .bento-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
//   .bento-kort       — hover (basstilen ligger inline på kortet):
//                         .bento-kort { transition: box-shadow 180ms ease, transform 180ms ease; }
//                         .bento-kort:hover { box-shadow: var(--skugga-lyft); transform: translateY(-2px); }
//   .bento-kort--live — de två live-korten (Bokföring, Rådgivning); spänner
//                       två kolumner på desktop:
//                         @media (min-width: 980px) { .bento-kort--live { grid-column: span 2; } }
//
// Färger enbart via förälderns CSS-variabler. Mono används ENDAST för
// siffror/konton ("4010" i bokföringsikonen) — aldrig för etiketter.

import { motion } from "framer-motion";
import type { CSSProperties, JSX, ReactNode } from "react";

type Status = "live" | "kommande";

type Modul = {
  id: string;
  titel: string;
  text: string;
  status: Status;
  Ikon: (props: { spelar: boolean }) => JSX.Element;
};

/* ------------------------------------------------------------------ */
/* Ikoner — geometriska inline-SVG:er, 40×40, viewBox 48, hårfina      */
/* linjer (1.5), rundade rekt (rx 3), max EN blå detalj per ikon.      */
/* ------------------------------------------------------------------ */

const bas = {
  fill: "none",
  stroke: "var(--ink)",
  strokeWidth: 1.5,
} as const;

const stilla = { duration: 0 } as const;

function Svg({ children }: { children: ReactNode }) {
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

/** Bokföring (live) — verifikat med kontorad. Mikroanimation:
 *  beloppsraden bredvid kontot "skrivs" (pathLength), håller, tonar ut. */
function IkonBokforing({ spelar }: { spelar: boolean }) {
  return (
    <Svg>
      <rect x="8" y="5" width="32" height="38" rx="3" {...bas} fill="var(--kort)" />
      <line x1="14" y1="13" x2="34" y2="13" stroke="var(--linje-stark)" strokeWidth="1.5" />
      <text
        x="14"
        y="24"
        fontFamily="var(--font-mono)"
        fontSize="7"
        fill="var(--ink)"
      >
        4010
      </text>
      <motion.line
        x1="27"
        y1="21.5"
        x2="34"
        y2="21.5"
        stroke="var(--ink)"
        strokeWidth="1.5"
        initial={false}
        animate={
          spelar
            ? { pathLength: [0, 1, 1, 1], opacity: [1, 1, 1, 0] }
            : { pathLength: 1, opacity: 1 }
        }
        transition={
          spelar
            ? {
                duration: 6,
                times: [0, 0.25, 0.85, 1],
                repeat: Infinity,
                ease: "easeInOut",
              }
            : stilla
        }
      />
      <line x1="14" y1="30" x2="23" y2="30" stroke="var(--ink-svag)" strokeWidth="1.5" />
      <rect x="27" y="27.5" width="7" height="5" rx="1" fill="var(--bla)" />
      <line x1="14" y1="37" x2="34" y2="37" stroke="var(--ink)" strokeWidth="1.5" />
    </Svg>
  );
}

/** Rådgivning (live) — pratbubbla med § och källrad. Mikroanimation:
 *  bubblan bobbar mycket svagt (transform) och den blå källraden pulserar
 *  i opacitet. */
function IkonRadgivning({ spelar }: { spelar: boolean }) {
  return (
    <Svg>
      <motion.g
        initial={false}
        animate={spelar ? { y: [0, -1.5, 0] } : { y: 0 }}
        transition={
          spelar
            ? { duration: 7, repeat: Infinity, ease: "easeInOut" }
            : stilla
        }
      >
        <rect x="6" y="8" width="36" height="25" rx="5" {...bas} fill="var(--kort)" />
        <path d="M 15 33 L 15 40 L 23 33" {...bas} fill="var(--kort)" />
        <text
          x="16"
          y="25"
          textAnchor="middle"
          fontFamily="var(--font-sans)"
          fontSize="12"
          fill="var(--ink)"
        >
          §
        </text>
        <line x1="23" y1="16.5" x2="36" y2="16.5" stroke="var(--ink-svag)" strokeWidth="1.2" />
        <line x1="23" y1="21.5" x2="33" y2="21.5" stroke="var(--ink-svag)" strokeWidth="1.2" />
        <motion.line
          x1="23"
          y1="26.5"
          x2="30"
          y2="26.5"
          stroke="var(--bla)"
          strokeWidth="1.5"
          initial={false}
          animate={spelar ? { opacity: [1, 0.45, 1] } : { opacity: 1 }}
          transition={
            spelar
              ? { duration: 7, repeat: Infinity, ease: "easeInOut" }
              : stilla
          }
        />
      </motion.g>
    </Svg>
  );
}

/** Kundappen (kommande) — telefon som fotar kvitto; blå skannlinje. */
function IkonKundapp(_props: { spelar: boolean }) {
  return (
    <Svg>
      <rect x="15" y="5" width="18" height="38" rx="3" {...bas} fill="var(--kort)" />
      <rect x="19" y="11" width="10" height="14" rx="1" fill="none" stroke="var(--ink-svag)" strokeWidth="1.2" />
      <line x1="21" y1="15" x2="27" y2="15" stroke="var(--ink-svag)" strokeWidth="1.2" />
      <line x1="21" y1="22" x2="25" y2="22" stroke="var(--ink-svag)" strokeWidth="1.2" />
      <line x1="19" y1="18.5" x2="29" y2="18.5" stroke="var(--bla)" strokeWidth="1.2" />
      <line x1="21" y1="37" x2="27" y2="37" stroke="var(--ink)" strokeWidth="1.5" />
    </Svg>
  );
}

/** Löner (kommande) — lönespec med rader; blått mynt som EN detalj. */
function IkonLoner(_props: { spelar: boolean }) {
  return (
    <Svg>
      <rect x="8" y="8" width="32" height="32" rx="3" {...bas} fill="var(--kort)" />
      <line x1="8" y1="16" x2="40" y2="16" stroke="var(--linje-stark)" strokeWidth="1.5" />
      <line x1="14" y1="23" x2="26" y2="23" stroke="var(--ink-svag)" strokeWidth="1.5" />
      <line x1="14" y1="29" x2="26" y2="29" stroke="var(--ink-svag)" strokeWidth="1.5" />
      <circle cx="33.5" cy="26" r="4" fill="none" stroke="var(--bla)" strokeWidth="1.5" />
      <line x1="14" y1="35" x2="30" y2="35" stroke="var(--ink)" strokeWidth="1.5" />
    </Svg>
  );
}

/** Bokslut (kommande) — avstämningslista; blå bock i rutan. */
function IkonBokslut(_props: { spelar: boolean }) {
  return (
    <Svg>
      <rect x="9" y="7" width="30" height="34" rx="3" {...bas} fill="var(--kort)" />
      <line x1="15" y1="15" x2="33" y2="15" stroke="var(--ink-svag)" strokeWidth="1.5" />
      <line x1="15" y1="21" x2="33" y2="21" stroke="var(--ink-svag)" strokeWidth="1.5" />
      <line x1="15" y1="27" x2="33" y2="27" stroke="var(--ink-svag)" strokeWidth="1.5" />
      <rect x="15" y="31" width="7" height="6" rx="1" fill="none" stroke="var(--ink)" strokeWidth="1.5" />
      <path d="M 17 34 L 18.5 35.5 L 21 32.5" fill="none" stroke="var(--bla)" strokeWidth="1.5" />
    </Svg>
  );
}

/** Skatt & juridik (kommande) — rund badge; blått § som EN detalj. */
function IkonSkatt(_props: { spelar: boolean }) {
  return (
    <Svg>
      <rect x="9" y="9" width="30" height="30" rx="15" {...bas} fill="var(--kort)" />
      <text
        x="24"
        y="29"
        textAnchor="middle"
        fontFamily="var(--font-sans)"
        fontSize="13"
        fill="var(--bla)"
      >
        §
      </text>
    </Svg>
  );
}

/* ------------------------------------------------------------------ */
/* Innehåll                                                            */
/* ------------------------------------------------------------------ */

const MODULER: readonly Modul[] = [
  {
    id: "bokforing",
    titel: "Bokföring",
    text: "Underlag in — BAS-kontering och momssats med lagrum, direkt i attestkön.",
    status: "live",
    Ikon: IkonBokforing,
  },
  {
    id: "radgivning",
    titel: "Rådgivning",
    text: "Svar om konton, moms och lagrum — alltid med källa och konfidens.",
    status: "live",
    Ikon: IkonRadgivning,
  },
  {
    id: "kundappen",
    titel: "Kundappen",
    text: "Era kunder fotar kvittot — det bokför sig självt.",
    status: "kommande",
    Ikon: IkonKundapp,
  },
  {
    id: "loner",
    titel: "Löner",
    text: "Rådgivning först, kontering sen — vi integrerar i stället för att bygga en egen beräkningsmotor.",
    status: "kommande",
    Ikon: IkonLoner,
  },
  {
    id: "bokslut",
    titel: "Bokslut",
    text: "Periodiseringar och avstämningar som förslag i samma attestväg.",
    status: "kommande",
    Ikon: IkonBokslut,
  },
  {
    id: "skatt",
    titel: "Skatt & juridik",
    text: "Fler rättskällor på samma rådgivningsgrund — alltid med lagrum.",
    status: "kommande",
    Ikon: IkonSkatt,
  },
] as const;

/* ------------------------------------------------------------------ */
/* Stilar (basstil inline; hover + responsiva kolumner i publik.css)   */
/* ------------------------------------------------------------------ */

const gridStil: CSSProperties = {
  display: "grid",
  gap: 16,
  // OBS: ingen gridTemplateColumns här — 1 kolumn är grid-default
  // (mobil-fallback); publik.css sätter 2/4 kolumner vid brytpunkterna.
};

const kortStil: CSSProperties = {
  background: "var(--kort)",
  border: "1px solid var(--linje)",
  borderRadius: 15,
  boxShadow: "var(--skugga-kort)",
  padding: 22,
  display: "flex",
  flexDirection: "column",
  gap: 16,
  minWidth: 0,
  boxSizing: "border-box",
};

const ikonPlattaLive: CSSProperties = {
  width: 64,
  height: 64,
  borderRadius: 12,
  background: "var(--yta-is)",
  border: "1px solid var(--linje)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

function chipStil(live: boolean): CSSProperties {
  return {
    fontFamily: "var(--font-sans)",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    lineHeight: 1,
    color: live ? "var(--gron)" : "var(--ink-svag)",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap",
    paddingTop: 4,
  };
}

/* ------------------------------------------------------------------ */
/* Kort + sektion                                                      */
/* ------------------------------------------------------------------ */

function Kort({ modul, spelar }: { modul: Modul; spelar: boolean }) {
  const live = modul.status === "live";
  const Ikon = modul.Ikon;
  return (
    <article
      className={live ? "bento-kort bento-kort--live" : "bento-kort"}
      style={live ? { ...kortStil, minHeight: 200 } : kortStil}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        {live ? (
          <div aria-hidden="true" style={ikonPlattaLive}>
            <Ikon spelar={spelar} />
          </div>
        ) : (
          <div aria-hidden="true" style={{ opacity: 0.6 }}>
            <Ikon spelar={false} />
          </div>
        )}
        <span style={chipStil(live)}>
          {live ? (
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: "var(--gron)",
                display: "inline-block",
              }}
            />
          ) : null}
          {live ? "Live" : "Kommande"}
        </span>
      </div>
      <div style={{ marginTop: "auto" }}>
        <h3
          style={{
            margin: 0,
            fontFamily: "var(--font-sans)",
            fontSize: live ? 18 : 16,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: "var(--ink)",
            opacity: live ? 1 : 0.6,
          }}
        >
          {modul.titel}
        </h3>
        <p
          style={{
            margin: "6px 0 0",
            fontFamily: "var(--font-sans)",
            fontSize: 14,
            lineHeight: 1.55,
            color: "var(--ink-mjuk)",
            maxWidth: live ? 420 : undefined,
          }}
        >
          {modul.text}
        </p>
      </div>
    </article>
  );
}

export default function BentoModuler({ spelar }: { spelar: boolean }) {
  return (
    <div className="bento-grid" style={gridStil}>
      {MODULER.map((modul) => (
        <Kort key={modul.id} modul={modul} spelar={spelar} />
      ))}
    </div>
  );
}
