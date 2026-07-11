"use client";

import { motion, useScroll, useTransform } from "framer-motion";

// Ambient bakgrund i hero (v4): pixelblock i D1-märkets språk
// (docs/brand/BRAND.md — pixelkvitto 3×5, perforeringen i botten,
// accentpixeln ENDAST på beloppsraden, som får blinka lugnt; blå
// variant enligt riktningsbytet). Lösa pixlar
// driver långsamt; två gånger per cykel monteras de ihop till
// kvittoformer i kanterna. Mycket låg opacitet — levande system,
// aldrig distraherande. `spelar` kommer från useSpelar (mounted &&
// !prefers-reduced-motion); vid false renderas svaga, stilla
// kvittoformer. Döljs helt på smala skärmar (publik.css).

const CELL = 13;
const PITCH = 15; // cell 13 + mellanrum 2 — märkets proportioner

// 3×5-rutnätet minus mittenpixeln i bottenraden = perforeringen.
// Accentpixeln = beloppsraden (rad 1, mitten), enligt BRAND.md.
const KVITTO: { kol: number; rad: number; rust?: boolean }[] = [
  { kol: 0, rad: 0 }, { kol: 1, rad: 0 }, { kol: 2, rad: 0 },
  { kol: 0, rad: 1 }, { kol: 1, rad: 1, rust: true }, { kol: 2, rad: 1 },
  { kol: 0, rad: 2 }, { kol: 1, rad: 2 }, { kol: 2, rad: 2 },
  { kol: 0, rad: 3 }, { kol: 1, rad: 3 }, { kol: 2, rad: 3 },
  { kol: 0, rad: 4 }, { kol: 2, rad: 4 },
];

// Deterministisk "slump" ur index — samma på server och klient.
function brus(i: number, salt: number) {
  const a = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return (a - Math.floor(a)) * 2 - 1; // -1..1
}

function PixelKvitto({
  x,
  y,
  fas,
  spelar,
}: {
  x: string;
  y: string;
  fas: number;
  spelar: boolean;
}) {
  return (
    <div style={{ position: "absolute", left: x, top: y }}>
      {KVITTO.map((p, i) => {
        const malX = p.kol * PITCH;
        const malY = p.rad * PITCH;
        const dx = brus(i, 1) * 56;
        const dy = brus(i, 2) * 44;
        const topp = p.rust ? 0.16 : 0.08;
        return (
          <motion.div
            key={i}
            style={{
              position: "absolute",
              width: CELL,
              height: CELL,
              borderRadius: 2,
              background: p.rust ? "var(--bla)" : "var(--ink)",
              left: malX,
              top: malY,
            }}
            initial={false}
            animate={
              spelar
                ? {
                    opacity: p.rust
                      ? [0, topp, 0.09, topp, 0] // beloppsraden blinkar lugnt
                      : [0, topp, topp, topp, 0],
                    x: [dx, 0, 0, 0, dx * -0.6],
                    y: [dy, 0, 0, 0, dy * -0.6],
                  }
                : { opacity: p.rust ? 0.09 : 0.05, x: 0, y: 0 }
            }
            transition={
              spelar
                ? {
                    duration: 26,
                    times: [0, 0.2, 0.45, 0.72, 1],
                    ease: "easeInOut",
                    repeat: Infinity,
                    delay: fas + i * 0.11,
                  }
                : { duration: 0 }
            }
          />
        );
      })}
    </div>
  );
}

// Svävande kuber i tre djup (v6): större = närmare = mer parallax
// och långsammare drift. Lekfullt men aldrig distraherande.
const KUBER: { x: string; y: string; storlek: number; djup: number; blur?: boolean }[] = [
  { x: "4%", y: "12%", storlek: 13, djup: 0.4 },
  { x: "13%", y: "64%", storlek: 22, djup: 0.9, blur: true },
  { x: "9%", y: "38%", storlek: 13, djup: 0.5 },
  { x: "88%", y: "16%", storlek: 18, djup: 0.7 },
  { x: "94%", y: "48%", storlek: 13, djup: 0.4 },
  { x: "84%", y: "76%", storlek: 26, djup: 1, blur: true },
  { x: "22%", y: "86%", storlek: 16, djup: 0.6 },
  { x: "76%", y: "90%", storlek: 13, djup: 0.5 },
  { x: "48%", y: "8%", storlek: 15, djup: 0.6 },
];

// En kub: yttre lagret bär scroll-parallaxen (olika per djup), det
// inre den lugna driften + svaga rotationen.
function Kub({
  kub,
  index,
  spelar,
}: {
  kub: (typeof KUBER)[number];
  index: number;
  spelar: boolean;
}) {
  const { scrollY } = useScroll();
  const parallax = useTransform(scrollY, [0, 900], [0, -64 * kub.djup]);
  return (
    <motion.div
      style={{
        position: "absolute",
        left: kub.x,
        top: kub.y,
        y: spelar ? parallax : 0,
      }}
    >
      <motion.div
        style={{
          width: kub.storlek,
          height: kub.storlek,
          borderRadius: Math.max(2, kub.storlek / 6),
          background: "var(--ink)",
          filter: kub.blur ? "blur(1.5px)" : undefined,
        }}
        initial={false}
        animate={
          spelar
            ? {
                opacity: 0.045 + kub.djup * 0.035,
                y: [0, brus(index, 3) * 20, 0],
                x: [0, brus(index, 4) * 14, 0],
                rotate: [0, brus(index, 5) * 5, 0],
              }
            : { opacity: 0.04, y: 0, x: 0, rotate: 0 }
        }
        transition={
          spelar
            ? { duration: 26 + index * 4, ease: "easeInOut", repeat: Infinity }
            : { duration: 0 }
        }
      />
    </motion.div>
  );
}

export default function HeroPixlar({ spelar }: { spelar: boolean }) {
  return (
    <div className="hero-pixlar" aria-hidden="true">
      <PixelKvitto x="5%" y="16%" fas={0} spelar={spelar} />
      <PixelKvitto x="90%" y="40%" fas={13} spelar={spelar} />
      {KUBER.map((kub, i) => (
        <Kub key={i} kub={kub} index={i} spelar={spelar} />
      ))}
    </div>
  );
}
