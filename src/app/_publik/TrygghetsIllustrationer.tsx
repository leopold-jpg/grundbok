"use client";

/**
 * TrygghetsIllustrationer — tre självinnehållna SVG-illustrationer för
 * förtroendesektionens trygghetskort på publika sajten.
 *
 *   IllustrationErData    — "Er data är er": ett dokumentkort vilar tryggt
 *                           innanför en mjukt rundad ram (er värld); utanför
 *                           antyds träning/utsidan som en bruten, avvisad
 *                           bana — en kort streckad pil som stannar mot ramen.
 *   IllustrationSistaOrdet — "En människa har sista ordet": en attest-knapp
 *                           med mänsklig silhuett-antydan (ren geometri) och
 *                           grön bock, över ett dokumentflöde; en liten
 *                           policy-regelrad bredvid.
 *   IllustrationSparbart  — "Allt är spårbart": en logg av staplade rader
 *                           med hash-flikar (mono) länkade av en tunn
 *                           kedjelinje; en rad i taget tänds uppifrån och ner.
 *
 * Props-kontrakt: { spelar: boolean }
 *   spelar = mounted && !prefers-reduced-motion, och sätts av föräldern.
 *   Servern renderar alltid spelar=false: då visas ett statiskt, komplett
 *   slutläge med exakt samma DOM-struktur (inga animationer), så hydrering
 *   aldrig kan mismatcha. Först när föräldern flippar spelar=true efter
 *   mount startar de lugna, loopande mikroanimationerna (6–9 s, easeInOut,
 *   endast transform/opacity/pathLength).
 *
 * Färger: uteslutande CSS-variabler från publik-scopet (--yta, --yta-is,
 * --kort, --ink-mjuk, --ink-svag, --linje, --linje-stark, --bla, --gron)
 * samt --font-sans för etiketter och --font-mono för hash-flikarna.
 * Max en blå accent per motiv; grönt används endast för bocken i motiv 2.
 * Illustrationerna ligger på glass-kort — därför transparent bakgrund och
 * luftiga kompositioner utan täckande plattor.
 * Ingen semantik (role="presentation", aria-hidden) — all förklarande text
 * står utanför i sektionen.
 */

import type { CSSProperties } from "react";
import { motion } from "framer-motion";

const SVG_STIL: CSSProperties = {
  width: "100%",
  height: "auto",
};

/** Grotesk etikett i small-caps-manér (versaler, spärrad). */
const ETIKETT: CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontWeight: 600,
  letterSpacing: "0.14em",
};

/** Mono — används ENDAST för hash-flikarna. */
const MONO: CSSProperties = {
  fontFamily: "var(--font-mono)",
  letterSpacing: "0.06em",
};

/* ================================================================== */
/* 1 — Er data är er                                                   */
/* ================================================================== */

export function IllustrationErData({ spelar }: { spelar: boolean }) {
  return (
    <svg
      viewBox="0 0 320 200"
      role="presentation"
      aria-hidden="true"
      style={SVG_STIL}
    >
      {/* er värld: mjukt tonad insida (halvtransparent is, ingen platta) */}
      <rect
        x={58}
        y={24}
        width={172}
        height={152}
        rx={8}
        fill="var(--yta-is)"
        fillOpacity={0.5}
      />

      {/* ramen — motivets enda blå accent; "andas" via subtil opacity-puls */}
      <motion.rect
        x={58}
        y={24}
        width={172}
        height={152}
        rx={8}
        fill="none"
        stroke="var(--bla)"
        strokeWidth={1.25}
        opacity={spelar ? undefined : 0.85}
        initial={spelar ? { opacity: 0.85 } : false}
        animate={spelar ? { opacity: [0.85, 0.55, 0.85] } : undefined}
        transition={
          spelar
            ? {
                duration: 6.5,
                repeat: Infinity,
                ease: "easeInOut",
                times: [0, 0.5, 1],
              }
            : undefined
        }
      />

      {/* dokumentkortet som vilar innanför ramen */}
      <rect
        x={104}
        y={56}
        width={80}
        height={76}
        rx={4}
        fill="var(--kort)"
        stroke="var(--linje-stark)"
        strokeWidth={1}
      />
      <line
        x1={116}
        y1={74}
        x2={150}
        y2={74}
        stroke="var(--ink-svag)"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <line
        x1={116}
        y1={88}
        x2={172}
        y2={88}
        stroke="var(--linje-stark)"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <line
        x1={116}
        y1={100}
        x2={164}
        y2={100}
        stroke="var(--linje-stark)"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <line
        x1={116}
        y1={112}
        x2={169}
        y2={112}
        stroke="var(--linje-stark)"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <text
        x={144}
        y={158}
        textAnchor="middle"
        fontSize={9}
        fill="var(--ink-svag)"
        style={ETIKETT}
      >
        ER DATA
      </text>

      {/* utsidan: bruten, avvisad bana som stannar mot ramen — tonar lugnt */}
      <motion.g
        opacity={spelar ? undefined : 0.9}
        initial={spelar ? { opacity: 0.9 } : false}
        animate={spelar ? { opacity: [0.35, 0.9, 0.35] } : undefined}
        transition={
          spelar
            ? {
                duration: 7.5,
                repeat: Infinity,
                ease: "easeInOut",
                times: [0, 0.5, 1],
              }
            : undefined
        }
      >
        <line
          x1={302}
          y1={96}
          x2={250}
          y2={96}
          stroke="var(--ink-svag)"
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeDasharray="5 5"
        />
        <path
          d="M 246 89 L 238 96 L 246 103"
          fill="none"
          stroke="var(--ink-svag)"
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text
          x={272}
          y={78}
          textAnchor="middle"
          fontSize={9}
          fill="var(--ink-svag)"
          style={ETIKETT}
        >
          TRÄNING
        </text>
      </motion.g>
    </svg>
  );
}

/* ================================================================== */
/* 2 — En människa har sista ordet                                     */
/* ================================================================== */

export function IllustrationSistaOrdet({ spelar }: { spelar: boolean }) {
  return (
    <svg
      viewBox="0 0 320 200"
      role="presentation"
      aria-hidden="true"
      style={SVG_STIL}
    >
      <text
        x={160}
        y={40}
        textAnchor="middle"
        fontSize={9}
        fill="var(--ink-svag)"
        style={ETIKETT}
      >
        ATTEST
      </text>

      {/* attest-knappen: lugnt tryck (scale 0.97) i loopen */}
      <motion.g
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
        initial={spelar ? { scale: 1 } : false}
        animate={spelar ? { scale: [1, 1, 0.97, 1, 1] } : undefined}
        transition={
          spelar
            ? {
                duration: 7,
                repeat: Infinity,
                ease: "easeInOut",
                times: [0, 0.14, 0.2, 0.26, 1],
              }
            : undefined
        }
      >
        <rect
          x={110}
          y={54}
          width={100}
          height={48}
          rx={8}
          fill="var(--kort)"
          stroke="var(--linje-stark)"
          strokeWidth={1}
        />

        {/* mänsklig silhuett-antydan: huvud + axelbåge, ren geometri */}
        <circle
          cx={134}
          cy={71}
          r={5.5}
          fill="none"
          stroke="var(--ink-mjuk)"
          strokeWidth={1.5}
        />
        <path
          d="M 124 90 a 10 8 0 0 1 20 0"
          fill="none"
          stroke="var(--ink-mjuk)"
          strokeWidth={1.5}
          strokeLinecap="round"
        />

        {/* bocken — enda gröna detaljen; ritas in med pathLength */}
        <motion.path
          d="M 158 79 l 7 7 l 16 -15"
          fill="none"
          stroke="var(--gron)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={spelar ? { pathLength: 0, opacity: 0 } : false}
          animate={
            spelar
              ? {
                  pathLength: [0, 0, 1, 1, 1, 0],
                  opacity: [0, 0, 1, 1, 0, 0],
                }
              : undefined
          }
          transition={
            spelar
              ? {
                  duration: 7,
                  repeat: Infinity,
                  ease: "easeInOut",
                  times: [0, 0.22, 0.36, 0.82, 0.9, 1],
                }
              : undefined
          }
        />
      </motion.g>

      {/* policy som liten regelrad bredvid — motivets enda blå accent */}
      <line
        x1={214}
        y1={78}
        x2={224}
        y2={78}
        stroke="var(--linje-stark)"
        strokeWidth={1}
        strokeDasharray="2 3"
      />
      <rect
        x={224}
        y={63}
        width={64}
        height={30}
        rx={4}
        fill="none"
        stroke="var(--bla)"
        strokeWidth={1}
      />
      <text
        x={256}
        y={76}
        textAnchor="middle"
        fontSize={9}
        fill="var(--bla)"
        style={ETIKETT}
      >
        POLICY
      </text>
      <line
        x1={234}
        y1={84}
        x2={278}
        y2={84}
        stroke="var(--bla)"
        strokeWidth={1}
        opacity={0.45}
        strokeLinecap="round"
      />

      {/* dokumentflödet under knappen */}
      <line
        x1={160}
        y1={102}
        x2={160}
        y2={130}
        stroke="var(--linje)"
        strokeWidth={1}
      />
      <g opacity={0.75}>
        <line
          x1={36}
          y1={152}
          x2={284}
          y2={152}
          stroke="var(--linje)"
          strokeWidth={1}
        />
        {[72, 152, 232].map((x) => (
          <g key={x}>
            <rect
              x={x}
              y={132}
              width={16}
              height={20}
              rx={2}
              fill="var(--kort)"
              stroke="var(--linje-stark)"
              strokeWidth={1}
            />
            <line
              x1={x + 4}
              y1={139}
              x2={x + 12}
              y2={139}
              stroke="var(--linje-stark)"
              strokeWidth={1}
            />
            <line
              x1={x + 4}
              y1={145}
              x2={x + 10}
              y2={145}
              stroke="var(--linje-stark)"
              strokeWidth={1}
            />
          </g>
        ))}
      </g>
    </svg>
  );
}

/* ================================================================== */
/* 3 — Allt är spårbart                                                */
/* ================================================================== */

const LOGGRADER = [
  { y: 30, hash: "9f2c…" },
  { y: 68, hash: "b41a…" },
  { y: 106, hash: "7e0d…" },
  { y: 144, hash: "c58f…" },
];

export function IllustrationSparbart({ spelar }: { spelar: boolean }) {
  return (
    <svg
      viewBox="0 0 320 200"
      role="presentation"
      aria-hidden="true"
      style={SVG_STIL}
    >
      <text
        x={74}
        y={18}
        fontSize={9}
        fill="var(--ink-svag)"
        style={ETIKETT}
      >
        HÄNDELSELOGG
      </text>

      {/* kedjelinjen som länkar raderna */}
      <line
        x1={60}
        y1={43}
        x2={60}
        y2={157}
        stroke="var(--linje-stark)"
        strokeWidth={1}
      />
      {LOGGRADER.map((r) => (
        <circle
          key={r.hash}
          cx={60}
          cy={r.y + 13}
          r={3}
          fill="var(--yta)"
          stroke="var(--ink-svag)"
          strokeWidth={1}
        />
      ))}

      {/* loggrader med hash-flik */}
      {LOGGRADER.map((r, i) => {
        const mitt = r.y + 13;
        const s = 0.04 + i * 0.23;
        return (
          <g key={r.hash}>
            <rect
              x={74}
              y={r.y}
              width={176}
              height={26}
              rx={4}
              fill="var(--kort)"
              fillOpacity={0.55}
              stroke="var(--linje-stark)"
              strokeWidth={1}
            />
            <line
              x1={86}
              y1={mitt - 4}
              x2={166}
              y2={mitt - 4}
              stroke="var(--linje-stark)"
              strokeWidth={1}
              strokeLinecap="round"
            />
            <line
              x1={86}
              y1={mitt + 5}
              x2={146}
              y2={mitt + 5}
              stroke="var(--linje)"
              strokeWidth={1}
              strokeLinecap="round"
            />

            {/* hash-fliken — mono */}
            <rect
              x={246}
              y={mitt - 8}
              width={48}
              height={16}
              rx={3}
              fill="var(--yta-is)"
              stroke="var(--linje)"
              strokeWidth={1}
            />
            <text
              x={270}
              y={mitt + 3}
              textAnchor="middle"
              fontSize={9}
              fill="var(--ink-mjuk)"
              style={MONO}
            >
              {r.hash}
            </text>

            {/* tändningen: en rad i taget, uppifrån och ner — enda blå accenten */}
            <motion.rect
              x={74}
              y={r.y}
              width={176}
              height={26}
              rx={4}
              fill="none"
              stroke="var(--bla)"
              strokeWidth={1.25}
              opacity={spelar ? undefined : i === LOGGRADER.length - 1 ? 1 : 0}
              initial={spelar ? { opacity: 0 } : false}
              animate={
                spelar ? { opacity: [0, 0, 1, 1, 0, 0] } : undefined
              }
              transition={
                spelar
                  ? {
                      duration: 8,
                      repeat: Infinity,
                      ease: "easeInOut",
                      times: [0, s, s + 0.05, s + 0.16, s + 0.21, 1],
                    }
                  : undefined
              }
            />
          </g>
        );
      })}
    </svg>
  );
}
