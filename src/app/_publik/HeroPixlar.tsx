"use client";

import { motion } from "framer-motion";

// Ambient bakgrund i hero (v4): pixelblock i D1-märkets språk
// (docs/brand/BRAND.md — pixelkvitto 3×5, perforeringen i botten,
// rust ENDAST på beloppsraden, som får blinka lugnt). Lösa pixlar
// driver långsamt; två gånger per cykel monteras de ihop till
// kvittoformer i kanterna. Mycket låg opacitet — levande system,
// aldrig distraherande. `spelar` kommer från useSpelar (mounted &&
// !prefers-reduced-motion); vid false renderas svaga, stilla
// kvittoformer. Döljs helt på smala skärmar (publik.css).

const CELL = 13;
const PITCH = 15; // cell 13 + mellanrum 2 — märkets proportioner

// 3×5-rutnätet minus mittenpixeln i bottenraden = perforeringen.
// Rust = beloppsraden (rad 1, mitten), enligt BRAND.md.
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

// Lösa pixlar som driver i kanterna — systemet som aldrig står still.
const DRIFT: { x: string; y: string }[] = [
  { x: "4%", y: "12%" },
  { x: "13%", y: "64%" },
  { x: "9%", y: "38%" },
  { x: "88%", y: "16%" },
  { x: "94%", y: "48%" },
  { x: "84%", y: "76%" },
  { x: "22%", y: "86%" },
  { x: "76%", y: "90%" },
];

export default function HeroPixlar({ spelar }: { spelar: boolean }) {
  return (
    <div className="hero-pixlar" aria-hidden="true">
      <PixelKvitto x="5%" y="16%" fas={0} spelar={spelar} />
      <PixelKvitto x="90%" y="40%" fas={13} spelar={spelar} />
      {DRIFT.map((d, i) => (
        <motion.div
          key={i}
          style={{
            position: "absolute",
            left: d.x,
            top: d.y,
            width: CELL,
            height: CELL,
            borderRadius: 2,
            background: "var(--ink)",
          }}
          initial={false}
          animate={
            spelar
              ? { opacity: 0.05, y: [0, brus(i, 3) * 18, 0], x: [0, brus(i, 4) * 12, 0] }
              : { opacity: 0.04, y: 0, x: 0 }
          }
          transition={
            spelar
              ? { duration: 30 + i * 4, ease: "easeInOut", repeat: Infinity }
              : { duration: 0 }
          }
        />
      ))}
    </div>
  );
}
