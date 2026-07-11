"use client";

/**
 * StegScener — tre illustrerade SVG-scener för "Så funkar det"-sektionen
 * på publika sajten (v2, ersätter StegPaneler).
 *
 *   ScenSlappIn    — "Släpp in allt": tre källor med igenkännliga
 *                    miniatyrer — ett mejl, ett foto (telefon med kvitto)
 *                    och ert bokföringssystem (fönsterruta med tabellrader
 *                    + API-chip) — flödar via mjuka banor in i grundbok,
 *                    D1-pixelkvittots 3×5-form med blå accentpixel som
 *                    mottagare. Små paket glider staggat längs banorna.
 *   ScenAgenterna  — "Agenterna gör jobbet": ett verifikat byggs rad för
 *                    rad — konteringsrader ritas in, mono-konton
 *                    (4010/2641/2440) och belopp tonar fram, en lagrum-
 *                    chip "ML (2023:200)" och en konfidens-detalj dyker
 *                    upp, och verifikatet kvitteras med en grön bock.
 *   ScenSistaOrdet — "Ni har sista ordet": en ström av poster glider
 *                    genom systemet mot bokfört (dämpas); en enda
 *                    avvikelse bromsar mjukt in vid attest-punkten och
 *                    väntar hos människan. Lugnt och tryggt.
 *
 * Props-kontrakt: { spelar: boolean }
 *   spelar = mounted && !prefers-reduced-motion, och sätts av föräldern.
 *   Servern renderar alltid spelar=false: då visas ett statiskt, komplett
 *   slutläge med exakt samma DOM-struktur (initial={false}, statiska
 *   värden — inga animationer, inga keyframes), så hydrering aldrig kan
 *   mismatcha. Först när föräldern flippar spelar=true efter mount
 *   startar de lugna looparna (~8–9 s, endast transform/opacity/
 *   pathLength, easeInOut, inga studsar).
 *
 * Färger: uteslutande CSS-variabler ur det vit/blå systemet (--yta,
 * --yta-is, --kort, --ink, --ink-mjuk, --ink-svag, --linje,
 * --linje-stark, --bla, --bla-ljus, --gron). Etiketter i grotesk
 * small-caps (--font-sans, 600, 0.08em); mono (--font-mono) ENDAST för
 * konton och belopp. Max en blå accent-detalj per scen (utöver
 * D1-accentpixeln i scen 1); grönt ENDAST som status-bock i scen 2.
 * Scenerna bär ingen semantik (role="presentation", aria-hidden) — all
 * förklarande text står utanför i sektionen.
 */

import type { CSSProperties } from "react";
import { motion } from "framer-motion";

const SVG_STIL: CSSProperties = {
  display: "block",
  width: "100%",
  height: "auto",
};

/** Grotesk small-caps för etiketter (versal text i JSX). */
const ETIKETT: CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontWeight: 600,
  letterSpacing: "0.08em",
};

/** Mono — ENDAST konton och belopp. */
const MONO: CSSProperties = {
  fontFamily: "var(--font-mono)",
  letterSpacing: "0.02em",
};

type ScenProps = { spelar: boolean };

/* ================================================================== */
/* Scen 1 — Släpp in allt                                              */
/* ================================================================== */

/** D1-pixelkvittot i 1/3-skala av rutnätet: cell 7, pitch 8 (21/24/3). */
const MARK_X = 321;
const MARK_Y = 115;
const MARK_PITCH = 8;
const MARK_CELL = 7;

/** [kolumn, rad] — accentpixeln (1,1) ritas separat, (1,4) är perforeringen. */
const MARK_PIXLAR: Array<[number, number]> = [
  [0, 0], [1, 0], [2, 0],
  [0, 1],         [2, 1],
  [0, 2], [1, 2], [2, 2],
  [0, 3], [1, 3], [2, 3],
  [0, 4],         [2, 4],
];

/**
 * Banor källa → grundbok. Keyframe-offseten är samplade punkter på
 * respektive bézier så paketen följer kurvan mjukt.
 */
const BANOR = [
  {
    d: "M152 52 C212 52 236 122 284 128",
    startX: 147.5,
    startY: 47.5,
    xKf: [0, 0, 50, 89, 132, 132, 132],
    yKf: [0, 0, 18, 53, 76, 76, 76],
    tider: [0, 0.02, 0.11, 0.19, 0.27, 0.33, 1],
  },
  {
    d: "M152 130 C196 130 240 130 284 130",
    startX: 147.5,
    startY: 125.5,
    xKf: [0, 0, 44, 88, 132, 132, 132],
    yKf: [0, 0, 0, 0, 0, 0, 0],
    tider: [0, 0.35, 0.44, 0.52, 0.6, 0.66, 1],
  },
  {
    d: "M152 208 C212 208 236 138 284 132",
    startX: 147.5,
    startY: 203.5,
    xKf: [0, 0, 50, 89, 132, 132, 132],
    yKf: [0, 0, -18, -53, -76, -76, -76],
    tider: [0, 0.68, 0.77, 0.85, 0.93, 0.99, 1],
  },
];

/** Statiskt slutläge: paketen ligger i kö framme vid mottagarplattan. */
const PAKET_STATISK = [
  { x: 246, y: 125.5 },
  { x: 260, y: 125.5 },
  { x: 274, y: 125.5 },
];

export function ScenSlappIn({ spelar }: ScenProps) {
  return (
    <svg
      viewBox="0 0 400 260"
      role="presentation"
      aria-hidden="true"
      style={SVG_STIL}
    >
      {/* mjuka banor källa → grundbok */}
      {BANOR.map((b) => (
        <path
          key={b.d}
          d={b.d}
          fill="none"
          stroke="var(--linje-stark)"
          strokeWidth={1}
        />
      ))}

      {/* källa 1 — mejl */}
      <rect
        x={20}
        y={22}
        width={132}
        height={60}
        rx={6}
        fill="var(--kort)"
        stroke="var(--linje-stark)"
        strokeWidth={1}
      />
      <rect
        x={32}
        y={37}
        width={28}
        height={19}
        rx={3}
        fill="var(--yta)"
        stroke="var(--ink-mjuk)"
        strokeWidth={1.2}
      />
      <path
        d="M33 39 L46 49 L59 39"
        fill="none"
        stroke="var(--ink-mjuk)"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <text x={70} y={45} fontSize={9} fill="var(--ink-mjuk)" style={ETIKETT}>
        MEJL
      </text>
      <rect x={70} y={52} width={56} height={4} rx={2} fill="var(--linje)" />
      <rect x={70} y={60} width={36} height={4} rx={2} fill="var(--linje)" />

      {/* källa 2 — foto: telefon med kvitto på skärmen */}
      <rect
        x={20}
        y={100}
        width={132}
        height={60}
        rx={6}
        fill="var(--kort)"
        stroke="var(--linje-stark)"
        strokeWidth={1}
      />
      <rect
        x={36}
        y={108}
        width={22}
        height={44}
        rx={4}
        fill="var(--yta)"
        stroke="var(--ink-mjuk)"
        strokeWidth={1.2}
      />
      <rect x={43} y={112} width={8} height={2} rx={1} fill="var(--linje-stark)" />
      <rect
        x={40}
        y={118}
        width={14}
        height={26}
        rx={1}
        fill="var(--yta)"
        stroke="var(--linje-stark)"
        strokeWidth={1}
      />
      <line x1={43} y1={124} x2={51} y2={124} stroke="var(--linje-stark)" strokeWidth={1} />
      <line x1={43} y1={129} x2={51} y2={129} stroke="var(--linje-stark)" strokeWidth={1} />
      <line x1={43} y1={134} x2={48} y2={134} stroke="var(--linje-stark)" strokeWidth={1} />
      <text x={70} y={123} fontSize={9} fill="var(--ink-mjuk)" style={ETIKETT}>
        FOTO
      </text>
      <rect x={70} y={130} width={52} height={4} rx={2} fill="var(--linje)" />
      <rect x={70} y={138} width={30} height={4} rx={2} fill="var(--linje)" />

      {/* källa 3 — ert bokföringssystem: fönsterruta med tabellrader + API-chip */}
      <rect
        x={20}
        y={178}
        width={132}
        height={60}
        rx={6}
        fill="var(--kort)"
        stroke="var(--linje-stark)"
        strokeWidth={1}
      />
      <rect
        x={30}
        y={186}
        width={46}
        height={44}
        rx={4}
        fill="var(--yta)"
        stroke="var(--ink-mjuk)"
        strokeWidth={1.2}
      />
      <line x1={30} y1={196} x2={76} y2={196} stroke="var(--linje-stark)" strokeWidth={1} />
      <circle cx={36} cy={191} r={1.3} fill="var(--ink-svag)" />
      <circle cx={41} cy={191} r={1.3} fill="var(--ink-svag)" />
      <line x1={35} y1={204} x2={56} y2={204} stroke="var(--linje-stark)" strokeWidth={1} />
      <line x1={61} y1={204} x2={71} y2={204} stroke="var(--linje-stark)" strokeWidth={1} />
      <line x1={35} y1={212} x2={56} y2={212} stroke="var(--linje-stark)" strokeWidth={1} />
      <line x1={61} y1={212} x2={71} y2={212} stroke="var(--linje-stark)" strokeWidth={1} />
      <line x1={35} y1={220} x2={56} y2={220} stroke="var(--linje-stark)" strokeWidth={1} />
      <line x1={61} y1={220} x2={71} y2={220} stroke="var(--linje-stark)" strokeWidth={1} />
      <text x={84} y={198} fontSize={9} fill="var(--ink-mjuk)" style={ETIKETT}>
        ERT SYSTEM
      </text>
      <rect
        x={84}
        y={206}
        width={34}
        height={16}
        rx={8}
        fill="var(--yta-is)"
        stroke="var(--linje-stark)"
        strokeWidth={1}
      />
      <text
        x={101}
        y={217}
        textAnchor="middle"
        fontSize={9}
        fill="var(--ink-mjuk)"
        style={ETIKETT}
      >
        API
      </text>

      {/* mottagaren — isblå platta med intag och D1-pixelkvittot */}
      <rect
        x={286}
        y={86}
        width={94}
        height={98}
        rx={8}
        fill="var(--yta-is)"
        stroke="var(--linje)"
        strokeWidth={1}
      />
      <rect x={284.5} y={122} width={3} height={16} rx={1.5} fill="var(--ink-mjuk)" />
      {MARK_PIXLAR.map(([kol, rad]) => (
        <rect
          key={`${kol}-${rad}`}
          x={MARK_X + kol * MARK_PITCH}
          y={MARK_Y + rad * MARK_PITCH}
          width={MARK_CELL}
          height={MARK_CELL}
          fill="var(--ink)"
        />
      ))}
      {/* accentpixeln — beloppsraden, får blinka lugnt i digitala ytor */}
      <motion.rect
        x={MARK_X + MARK_PITCH}
        y={MARK_Y + MARK_PITCH}
        width={MARK_CELL}
        height={MARK_CELL}
        fill="var(--bla)"
        initial={spelar ? { opacity: 1 } : false}
        animate={spelar ? { opacity: [1, 0.45, 1] } : undefined}
        transition={
          spelar
            ? { duration: 4, repeat: Infinity, ease: "easeInOut" }
            : undefined
        }
      />
      <text
        x={333}
        y={202}
        textAnchor="middle"
        fontSize={9}
        fill="var(--ink)"
        style={ETIKETT}
      >
        GRUNDBOK
      </text>

      {/* paketen — scenens blå detalj: glider staggat längs banorna */}
      {BANOR.map((b, i) => (
        <motion.rect
          key={b.d}
          width={9}
          height={9}
          rx={2}
          fill="var(--bla-ljus)"
          x={spelar ? b.startX : PAKET_STATISK[i].x}
          y={spelar ? b.startY : PAKET_STATISK[i].y}
          initial={spelar ? { x: 0, y: 0, opacity: 0 } : false}
          animate={
            spelar
              ? { x: b.xKf, y: b.yKf, opacity: [0, 0, 1, 1, 1, 0, 0] }
              : undefined
          }
          transition={
            spelar
              ? {
                  duration: 8,
                  repeat: Infinity,
                  ease: "easeInOut",
                  times: b.tider,
                }
              : undefined
          }
        />
      ))}
    </svg>
  );
}

/* ================================================================== */
/* Scen 2 — Agenterna gör jobbet                                       */
/* ================================================================== */

const RADER = [
  {
    y: 104,
    konto: "4010",
    belopp: "1 250,00",
    linjeTider: [0, 0.04, 0.14, 0.88, 0.96, 1],
    textTider: [0, 0.14, 0.19, 0.88, 0.96, 1],
  },
  {
    y: 128,
    konto: "2641",
    belopp: "312,50",
    linjeTider: [0, 0.2, 0.3, 0.88, 0.96, 1],
    textTider: [0, 0.3, 0.35, 0.88, 0.96, 1],
  },
  {
    y: 152,
    konto: "2440",
    belopp: "1 562,50",
    linjeTider: [0, 0.36, 0.46, 0.88, 0.96, 1],
    textTider: [0, 0.46, 0.51, 0.88, 0.96, 1],
  },
];

export function ScenAgenterna({ spelar }: ScenProps) {
  return (
    <svg
      viewBox="0 0 400 260"
      role="presentation"
      aria-hidden="true"
      style={SVG_STIL}
    >
      {/* isblå detaljplatta bakom verifikatet */}
      <rect x={64} y={12} width={272} height={236} rx={10} fill="var(--yta-is)" />

      {/* verifikatkortet */}
      <rect
        x={92}
        y={30}
        width={216}
        height={200}
        rx={6}
        fill="var(--kort)"
        stroke="var(--linje-stark)"
        strokeWidth={1}
      />
      <text x={108} y={52} fontSize={9} fill="var(--ink-svag)" style={ETIKETT}>
        VERIFIKAT
      </text>
      <rect x={254} y={44} width={38} height={5} rx={2.5} fill="var(--linje)" />
      <line x1={108} y1={60} x2={292} y2={60} stroke="var(--linje)" strokeWidth={1} />

      {/* underlagets skelettrader — alltid på plats, konteringen byggs ovanpå */}
      <rect x={108} y={70} width={84} height={5} rx={2.5} fill="var(--linje)" />
      <rect x={108} y={80} width={52} height={4} rx={2} fill="var(--linje)" />

      {/* konteringsrader: linjen ritas in, konto och belopp tonar fram */}
      {RADER.map((r) => (
        <g key={r.konto}>
          <motion.text
            x={108}
            y={r.y + 3.5}
            fontSize={10}
            fill="var(--ink-mjuk)"
            style={MONO}
            initial={spelar ? { opacity: 0 } : false}
            animate={spelar ? { opacity: [0, 0, 1, 1, 0, 0] } : undefined}
            transition={
              spelar
                ? {
                    duration: 9,
                    repeat: Infinity,
                    ease: "easeInOut",
                    times: r.textTider,
                  }
                : undefined
            }
          >
            {r.konto}
          </motion.text>
          <motion.line
            x1={150}
            y1={r.y}
            x2={228}
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
                    duration: 9,
                    repeat: Infinity,
                    ease: "easeInOut",
                    times: r.linjeTider,
                  }
                : undefined
            }
          />
          <motion.text
            x={292}
            y={r.y + 3.5}
            textAnchor="end"
            fontSize={10}
            fill="var(--ink)"
            style={MONO}
            initial={spelar ? { opacity: 0 } : false}
            animate={spelar ? { opacity: [0, 0, 1, 1, 0, 0] } : undefined}
            transition={
              spelar
                ? {
                    duration: 9,
                    repeat: Infinity,
                    ease: "easeInOut",
                    times: r.textTider,
                  }
                : undefined
            }
          >
            {r.belopp}
          </motion.text>
        </g>
      ))}

      <line x1={108} y1={166} x2={292} y2={166} stroke="var(--linje)" strokeWidth={1} />

      {/* lagrum-chip — scenens blå accent */}
      <motion.g
        initial={spelar ? { opacity: 0 } : false}
        animate={spelar ? { opacity: [0, 0, 1, 1, 0, 0] } : undefined}
        transition={
          spelar
            ? {
                duration: 9,
                repeat: Infinity,
                ease: "easeInOut",
                times: [0, 0.56, 0.62, 0.88, 0.96, 1],
              }
            : undefined
        }
      >
        <rect
          x={108}
          y={172}
          width={100}
          height={20}
          rx={10}
          fill="var(--yta)"
          stroke="var(--bla)"
          strokeWidth={1}
        />
        <text
          x={158}
          y={185.5}
          textAnchor="middle"
          fontSize={9}
          fill="var(--bla)"
          style={ETIKETT}
        >
          ML (2023:200)
        </text>
      </motion.g>

      {/* konfidens-detalj */}
      <motion.g
        initial={spelar ? { opacity: 0 } : false}
        animate={spelar ? { opacity: [0, 0, 1, 1, 0, 0] } : undefined}
        transition={
          spelar
            ? {
                duration: 9,
                repeat: Infinity,
                ease: "easeInOut",
                times: [0, 0.62, 0.68, 0.88, 0.96, 1],
              }
            : undefined
        }
      >
        <text x={108} y={209} fontSize={9} fill="var(--ink-svag)" style={ETIKETT}>
          KONFIDENS
        </text>
        <rect x={172} y={203} width={54} height={4} rx={2} fill="var(--linje)" />
        <rect x={172} y={203} width={46} height={4} rx={2} fill="var(--ink-svag)" />
      </motion.g>

      {/* stämpeln — grön status-bock när verifikatet är klart */}
      <motion.g
        initial={spelar ? { opacity: 0, scale: 0.92 } : false}
        animate={
          spelar
            ? {
                opacity: [0, 0, 1, 1, 1, 0],
                scale: [0.92, 0.92, 1, 1, 1, 1],
              }
            : undefined
        }
        transition={
          spelar
            ? {
                duration: 9,
                repeat: Infinity,
                ease: "easeInOut",
                times: [0, 0.72, 0.78, 0.88, 0.96, 1],
              }
            : undefined
        }
        style={{ originX: "272px", originY: "202px" }}
      >
        <circle
          cx={272}
          cy={202}
          r={13}
          fill="var(--yta)"
          stroke="var(--gron)"
          strokeWidth={1.5}
        />
        <motion.path
          d="M265.5 202.5 l5 5 l9.5 -10.5"
          fill="none"
          stroke="var(--gron)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={spelar ? { pathLength: 0 } : false}
          animate={spelar ? { pathLength: [0, 0, 1, 1] } : undefined}
          transition={
            spelar
              ? {
                  duration: 9,
                  repeat: Infinity,
                  ease: "easeInOut",
                  times: [0, 0.76, 0.83, 1],
                }
              : undefined
          }
        />
      </motion.g>
    </svg>
  );
}

/* ================================================================== */
/* Scen 3 — Ni har sista ordet                                         */
/* ================================================================== */

/**
 * Statiskt slutläge: tre poster ligger dämpade i bokfört-facket,
 * en är på väg in från vänster.
 */
const KO_STATISK = [
  { x: 328, opacitet: 0.35 },
  { x: 347, opacitet: 0.35 },
  { x: 366, opacitet: 0.35 },
  { x: 96, opacitet: 1 },
];

export function ScenSistaOrdet({ spelar }: ScenProps) {
  return (
    <svg
      viewBox="0 0 400 260"
      role="presentation"
      aria-hidden="true"
      style={SVG_STIL}
    >
      {/* flödeslinjen */}
      <line x1={20} y1={130} x2={380} y2={130} stroke="var(--linje)" strokeWidth={1} />

      {/* attest-punkten — plattan där människan sitter */}
      <rect
        x={196}
        y={84}
        width={64}
        height={92}
        rx={8}
        fill="var(--yta-is)"
        stroke="var(--linje)"
        strokeWidth={1}
      />
      <circle
        cx={228}
        cy={101}
        r={5}
        fill="var(--yta)"
        stroke="var(--ink-mjuk)"
        strokeWidth={1.2}
      />
      <path
        d="M219 115 C219 108.5 237 108.5 237 115"
        fill="none"
        stroke="var(--ink-mjuk)"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <text
        x={228}
        y={74}
        textAnchor="middle"
        fontSize={9}
        fill="var(--ink-svag)"
        style={ETIKETT}
      >
        ATTEST
      </text>

      {/* bokfört-facket */}
      <rect
        x={316}
        y={109}
        width={62}
        height={42}
        rx={6}
        fill="var(--yta-is)"
        stroke="var(--linje)"
        strokeWidth={1}
      />
      <text
        x={347}
        y={168}
        textAnchor="middle"
        fontSize={9}
        fill="var(--ink-svag)"
        style={ETIKETT}
      >
        BOKFÖRT
      </text>

      {/* strömmen: poster som glider mjukt igenom och dämpas i facket */}
      {KO_STATISK.map((st, k) => {
        const s = 0.02 + k * 0.13;
        const tider = [0, s, s + 0.03, s + 0.2, s + 0.23, s + 0.31, s + 0.34, 1];
        return (
          <motion.g
            key={k}
            transform={spelar ? undefined : `translate(${st.x} 0)`}
            opacity={spelar ? undefined : st.opacitet}
            initial={spelar ? { x: 28, opacity: 0 } : false}
            animate={
              spelar
                ? {
                    x: [28, 28, 60, 228, 244, 330, 347, 347],
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
              x={-9}
              y={121}
              width={18}
              height={18}
              rx={3}
              fill="var(--kort)"
              stroke="var(--ink-mjuk)"
              strokeWidth={1}
            />
            <line x1={-5} y1={127} x2={5} y2={127} stroke="var(--linje-stark)" strokeWidth={1} />
            <line x1={-5} y1={132} x2={1} y2={132} stroke="var(--linje-stark)" strokeWidth={1} />
          </motion.g>
        );
      })}

      {/* avvikelsen: bromsar mjukt in vid attest och väntar hos människan */}
      <motion.g
        transform={spelar ? undefined : "translate(228 0)"}
        initial={spelar ? { x: 28, opacity: 0 } : false}
        animate={
          spelar
            ? {
                x: [28, 28, 70, 180, 214, 228, 228, 228, 228],
                opacity: [0, 0, 1, 1, 1, 1, 1, 0, 0],
              }
            : undefined
        }
        transition={
          spelar
            ? {
                duration: 9,
                repeat: Infinity,
                ease: "easeInOut",
                times: [0, 0.5, 0.54, 0.63, 0.68, 0.73, 0.94, 0.985, 1],
              }
            : undefined
        }
      >
        <rect
          x={-9}
          y={121}
          width={18}
          height={18}
          rx={3}
          fill="var(--kort)"
          stroke="var(--ink-mjuk)"
          strokeWidth={1}
        />
        <line x1={-5} y1={127} x2={5} y2={127} stroke="var(--linje-stark)" strokeWidth={1} />
        <line x1={-5} y1={132} x2={6} y2={132} stroke="var(--linje-stark)" strokeWidth={1} />
        {/* markeringen — scenens blå accent: lugn ring som andas vid pausen */}
        <motion.rect
          x={-12}
          y={118}
          width={24}
          height={24}
          rx={5}
          fill="none"
          stroke="var(--bla)"
          strokeWidth={1.5}
          initial={spelar ? { opacity: 0 } : false}
          animate={
            spelar
              ? { opacity: [0, 0, 1, 0.55, 1, 0.55, 1, 0] }
              : undefined
          }
          transition={
            spelar
              ? {
                  duration: 9,
                  repeat: Infinity,
                  ease: "easeInOut",
                  times: [0, 0.75, 0.79, 0.84, 0.88, 0.92, 0.94, 1],
                }
              : undefined
          }
        />
      </motion.g>
    </svg>
  );
}
