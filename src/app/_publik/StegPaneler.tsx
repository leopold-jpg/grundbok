"use client";

/**
 * StegPaneler — tre självinnehållna, illustrerade SVG-paneler för sektionen
 * "Så funkar det" på publika sajten.
 *
 *   PanelUnderlag   — tre källor (MEJL/FOTO/API) skickar små paket längs
 *                     ledlinjer in i en central inkorg.
 *   PanelKontering  — ett verifikatkort där tre konteringsrader skrivs fram,
 *                     BAS-kontona 4010/2641/2440 tonar in och en momschip
 *                     "ML (2023:200)" dyker upp.
 *   PanelAvvikelse  — en kö av poster glider genom attest-grinden; de flesta
 *                     passerar och bokförs själva (tonas dämpade), en enda
 *                     avvikelse får rostkant och stannar för attest.
 *
 * Props-kontrakt: { spelar: boolean }
 *   spelar = mounted && !prefers-reduced-motion, och sätts av föräldern.
 *   Servern renderar alltid spelar=false: då visas ett statiskt, komplett
 *   slutläge med exakt samma DOM-struktur (inga animationer, inga keyframes),
 *   så hydrering aldrig kan mismatcha. Först när föräldern flippar
 *   spelar=true efter mount startar de lugna, loopande mikroanimationerna.
 *
 * Färger: uteslutande CSS-variabler som ärvs från main.publik-scopet
 * (--ink, --ink-mjuk, --ink-svag, --rost, --papper, --papper-elev,
 *  --papper-djup, --linje, --linje-stark) samt --font-mono för etiketter.
 * Panelerna bär ingen semantik (role="presentation", aria-hidden) —
 * all förklarande text står utanför i sektionen.
 */

import type { CSSProperties } from "react";
import { motion } from "framer-motion";

const MONO: CSSProperties = {
  fontFamily: "var(--font-mono)",
  letterSpacing: "0.08em",
};

const SVG_STIL: CSSProperties = {
  display: "block",
  width: "100%",
  height: "auto",
};

/* ================================================================== */
/* Panel 1 — släpp in underlaget                                       */
/* ================================================================== */

const KALLOR = [
  { etikett: "MEJL", boxY: 34, cy: 47 },
  { etikett: "FOTO", boxY: 97, cy: 110 },
  { etikett: "API", boxY: 160, cy: 173 },
];

/** Tidsfönster per paket (staggered tredjedelar av loopen). */
const PAKET_TIDER: number[][] = [
  [0, 0.02, 0.08, 0.26, 0.31, 1],
  [0, 0.35, 0.41, 0.59, 0.64, 1],
  [0, 0.68, 0.74, 0.92, 0.97, 1],
];

/** Statiskt slutläge: paketen ligger mottagna i inkorgen. */
const PAKET_STATISK_X = [240, 253, 266];

export function PanelUnderlag({ spelar }: { spelar: boolean }) {
  return (
    <svg
      viewBox="0 0 320 220"
      role="presentation"
      aria-hidden="true"
      style={SVG_STIL}
    >
      {/* ledlinjer källa → inkorgens slot */}
      {KALLOR.map((k) => (
        <line
          key={k.etikett}
          x1={78}
          y1={k.cy}
          x2={226}
          y2={110}
          stroke="var(--linje-stark)"
          strokeWidth={1}
        />
      ))}

      {/* källor */}
      {KALLOR.map((k) => (
        <g key={k.etikett}>
          <rect
            x={22}
            y={k.boxY}
            width={56}
            height={26}
            rx={3}
            fill="var(--papper-elev)"
            stroke="var(--linje-stark)"
            strokeWidth={1}
          />
          <text
            x={50}
            y={k.boxY + 17}
            textAnchor="middle"
            fontSize={9}
            fill="var(--ink-mjuk)"
            style={MONO}
          >
            {k.etikett}
          </text>
        </g>
      ))}

      {/* inkorg med slot */}
      <rect
        x={226}
        y={84}
        width={76}
        height={52}
        rx={3}
        fill="var(--papper-elev)"
        stroke="var(--linje-stark)"
        strokeWidth={1}
      />
      <rect
        x={224.5}
        y={101}
        width={3}
        height={18}
        rx={1.5}
        fill="var(--ink-mjuk)"
      />
      <text
        x={264}
        y={128}
        textAnchor="middle"
        fontSize={9}
        fill="var(--ink-svag)"
        style={MONO}
      >
        INKORG
      </text>

      {/* paket: glider ett i taget längs sin ledlinje in i sloten */}
      {KALLOR.map((k, i) => {
        const dx = 142; // 78 → 220 (strax utanför sloten)
        const dy = 110 - k.cy;
        return (
          <motion.rect
            key={k.etikett}
            width={9}
            height={9}
            rx={2}
            fill="var(--papper-elev)"
            stroke="var(--ink-mjuk)"
            strokeWidth={1}
            x={spelar ? 73.5 : PAKET_STATISK_X[i]}
            y={spelar ? k.cy - 4.5 : 101.5}
            initial={spelar ? { x: 0, y: 0, opacity: 0 } : false}
            animate={
              spelar
                ? {
                    x: [0, 0, dx * 0.18, dx * 0.85, dx, dx],
                    y: [0, 0, dy * 0.18, dy * 0.85, dy, dy],
                    opacity: [0, 0, 1, 1, 0, 0],
                  }
                : undefined
            }
            transition={
              spelar
                ? {
                    duration: 7.5,
                    repeat: Infinity,
                    ease: "easeInOut",
                    times: PAKET_TIDER[i],
                  }
                : undefined
            }
          />
        );
      })}
    </svg>
  );
}

/* ================================================================== */
/* Panel 2 — agenterna tolkar och konterar                             */
/* ================================================================== */

const RADER = [
  {
    y: 78,
    konto: "4010",
    linjeTider: [0, 0.05, 0.22, 0.86, 0.95, 1],
    talTider: [0, 0.23, 0.28, 0.86, 0.95, 1],
  },
  {
    y: 104,
    konto: "2641",
    linjeTider: [0, 0.24, 0.41, 0.86, 0.95, 1],
    talTider: [0, 0.42, 0.47, 0.86, 0.95, 1],
  },
  {
    y: 130,
    konto: "2440",
    linjeTider: [0, 0.43, 0.6, 0.86, 0.95, 1],
    talTider: [0, 0.61, 0.66, 0.86, 0.95, 1],
  },
];

export function PanelKontering({ spelar }: { spelar: boolean }) {
  return (
    <svg
      viewBox="0 0 320 220"
      role="presentation"
      aria-hidden="true"
      style={SVG_STIL}
    >
      {/* verifikatkortet */}
      <rect
        x={70}
        y={20}
        width={180}
        height={180}
        rx={3}
        fill="var(--papper-elev)"
        stroke="var(--linje-stark)"
        strokeWidth={1}
      />
      <text
        x={86}
        y={42}
        fontSize={9}
        fill="var(--ink-svag)"
        style={MONO}
      >
        VERIFIKAT
      </text>
      <line
        x1={86}
        y1={52}
        x2={234}
        y2={52}
        stroke="var(--linje)"
        strokeWidth={1}
      />

      {/* konteringsrader: punkt, rad som skrivs fram, konto som tonar in */}
      {RADER.map((r) => (
        <g key={r.konto}>
          <rect
            x={86}
            y={r.y - 3}
            width={6}
            height={6}
            rx={1.5}
            fill="var(--papper-djup)"
            stroke="var(--ink-svag)"
            strokeWidth={1}
          />
          <motion.line
            x1={100}
            y1={r.y}
            x2={192}
            y2={r.y}
            stroke="var(--ink-svag)"
            strokeWidth={1.5}
            strokeLinecap="round"
            initial={spelar ? { pathLength: 0, opacity: 1 } : false}
            animate={
              spelar
                ? {
                    pathLength: [0, 0, 1, 1, 1, 0],
                    opacity: [1, 1, 1, 1, 0, 0],
                  }
                : undefined
            }
            transition={
              spelar
                ? {
                    duration: 8.5,
                    repeat: Infinity,
                    ease: "easeInOut",
                    times: r.linjeTider,
                  }
                : undefined
            }
          />
          <motion.text
            x={234}
            y={r.y + 3.5}
            textAnchor="end"
            fontSize={10}
            fill="var(--ink-mjuk)"
            style={MONO}
            initial={spelar ? { opacity: 0 } : false}
            animate={spelar ? { opacity: [0, 0, 1, 1, 0, 0] } : undefined}
            transition={
              spelar
                ? {
                    duration: 8.5,
                    repeat: Infinity,
                    ease: "easeInOut",
                    times: r.talTider,
                  }
                : undefined
            }
          >
            {r.konto}
          </motion.text>
        </g>
      ))}

      {/* momschip — panelens enda accentdetalj */}
      <motion.g
        initial={spelar ? { opacity: 0 } : false}
        animate={spelar ? { opacity: [0, 0, 1, 1, 0, 0] } : undefined}
        transition={
          spelar
            ? {
                duration: 8.5,
                repeat: Infinity,
                ease: "easeInOut",
                times: [0, 0.68, 0.74, 0.86, 0.95, 1],
              }
            : undefined
        }
      >
        <rect
          x={86}
          y={156}
          width={92}
          height={20}
          rx={3}
          fill="var(--papper)"
          stroke="var(--rost)"
          strokeWidth={1}
        />
        <text
          x={132}
          y={169}
          textAnchor="middle"
          fontSize={9}
          fill="var(--rost)"
          style={MONO}
        >
          ML (2023:200)
        </text>
      </motion.g>
    </svg>
  );
}

/* ================================================================== */
/* Panel 3 — ni attesterar bara avvikelserna                           */
/* ================================================================== */

/**
 * Statiskt slutläge för de fyra vanliga posterna: tre har passerat grinden
 * och ligger dämpade till höger, en är på väg in från vänster.
 */
const KO_STATISK = [
  { x: 262, opacitet: 0.35 },
  { x: 226, opacitet: 0.35 },
  { x: 205, opacitet: 0.35 },
  { x: 96, opacitet: 1 },
];

export function PanelAvvikelse({ spelar }: { spelar: boolean }) {
  return (
    <svg
      viewBox="0 0 320 220"
      role="presentation"
      aria-hidden="true"
      style={SVG_STIL}
    >
      {/* flödeslinje */}
      <line
        x1={16}
        y1={110}
        x2={304}
        y2={110}
        stroke="var(--linje)"
        strokeWidth={1}
      />

      {/* grinden med stolpar */}
      <rect
        x={187}
        y={66}
        width={6}
        height={6}
        rx={1.5}
        fill="var(--papper-djup)"
        stroke="var(--ink-mjuk)"
        strokeWidth={1}
      />
      <line
        x1={190}
        y1={74}
        x2={190}
        y2={146}
        stroke="var(--ink-mjuk)"
        strokeWidth={1.5}
      />
      <rect
        x={187}
        y={148}
        width={6}
        height={6}
        rx={1.5}
        fill="var(--papper-djup)"
        stroke="var(--ink-mjuk)"
        strokeWidth={1}
      />
      <text
        x={190}
        y={58}
        textAnchor="middle"
        fontSize={9}
        fill="var(--ink-svag)"
        style={MONO}
      >
        ATTEST
      </text>
      <text
        x={298}
        y={140}
        textAnchor="end"
        fontSize={9}
        fill="var(--ink-svag)"
        style={MONO}
      >
        BOKFÖRT
      </text>

      {/* fyra poster som passerar grinden och tonas dämpade */}
      {KO_STATISK.map((st, k) => {
        const s = 0.02 + k * 0.13;
        const tider = [
          0,
          s,
          s + 0.03,
          s + 0.195,
          s + 0.21,
          s + 0.29,
          s + 0.32,
          1,
        ];
        return (
          <motion.g
            key={k}
            transform={spelar ? undefined : `translate(${st.x} 0)`}
            opacity={spelar ? undefined : st.opacitet}
            initial={spelar ? { x: 30, opacity: 0 } : false}
            animate={
              spelar
                ? {
                    x: [30, 30, 55, 190, 202, 268, 292, 292],
                    opacity: [0, 0, 1, 1, 0.35, 0.35, 0, 0],
                  }
                : undefined
            }
            transition={
              spelar
                ? {
                    duration: 9,
                    repeat: Infinity,
                    ease: "easeInOut",
                    times: tider,
                  }
                : undefined
            }
          >
            <rect
              x={-7}
              y={103}
              width={14}
              height={14}
              rx={2}
              fill="var(--papper-elev)"
              stroke="var(--ink-mjuk)"
              strokeWidth={1}
            />
          </motion.g>
        );
      })}

      {/* avvikelsen: stannar vid grinden och får rostkant — enda accenten */}
      <motion.g
        transform={spelar ? undefined : "translate(172 0)"}
        initial={spelar ? { x: 30, opacity: 0 } : false}
        animate={
          spelar
            ? {
                x: [30, 30, 55, 172, 172, 172, 172],
                opacity: [0, 0, 1, 1, 1, 0, 0],
              }
            : undefined
        }
        transition={
          spelar
            ? {
                duration: 9,
                repeat: Infinity,
                ease: "easeInOut",
                times: [0, 0.56, 0.59, 0.76, 0.94, 0.985, 1],
              }
            : undefined
        }
      >
        <rect
          x={-7}
          y={103}
          width={14}
          height={14}
          rx={2}
          fill="var(--papper-elev)"
          stroke="var(--ink-mjuk)"
          strokeWidth={1}
        />
        <motion.rect
          x={-9}
          y={101}
          width={18}
          height={18}
          rx={3}
          fill="none"
          stroke="var(--rost)"
          strokeWidth={1.5}
          initial={spelar ? { opacity: 0 } : false}
          animate={spelar ? { opacity: [0, 0, 1, 1, 1, 0] } : undefined}
          transition={
            spelar
              ? {
                  duration: 9,
                  repeat: Infinity,
                  ease: "easeInOut",
                  times: [0, 0.76, 0.8, 0.94, 0.985, 1],
                }
              : undefined
          }
        />
      </motion.g>
    </svg>
  );
}
