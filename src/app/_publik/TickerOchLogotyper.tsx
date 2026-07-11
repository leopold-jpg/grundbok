"use client";

/**
 * TickerOchLogotyper — två byggstenar för grundboks publika sida.
 *
 * RegTicker({ varde, spelar })
 *   varde:  teckensträngen som ska visas (t.ex. väntelistans registrerings-id "9f2c81d4").
 *   spelar: false ⇒ exakt `varde` som statisk text (servern renderar ALLTID spelar=false).
 *           true  ⇒ varje position rullar deterministiskt genom "0123456789abcdef"
 *           (startindex härlett ur positionen — ingen Math.random) och landar på sitt
 *           riktiga tecken, position för position vänster→höger (stagger ~70 ms,
 *           totalt ~1 s för 8 tecken). Efter landning visas exakt `varde`.
 *   Typografi: var(--font-mono) + tabular-nums (detta är ett värde/hash);
 *   färg och storlek ärvs från omgivningen.
 *
 * LogotypRad({ spelar })
 *   Social proof-rad: rubrikrad i liten grotesk + marquee-yta med två identiska
 *   sekvenser sida vid sida som translateX-loopar sömlöst (-50 % = exakt en
 *   sekvensbredd). spelar=false ⇒ stillastående (används av integratören för
 *   prefers-reduced-motion och för serverrendering); spelar=true ⇒ loopar.
 *   Byggs men renderas INTE i page.tsx ännu — se kommentaren vid komponenten.
 *
 * Klassnamn (endast krokar för integratörens CSS — all layout ligger i inline styles):
 *   ticker-rot     yttre <span> för RegTicker
 *   ticker-tecken  <span> per tecken i RegTicker
 *   logga-rot      yttre <section> för LogotypRad
 *   logga-rubrik   rubrikraden i liten grotesk
 *   logga-band     klippfönstret (overflow hidden) runt marqueen
 *   logga-spar     det animerade spåret (två sekvenser sida vid sida)
 *   logga-sekvens  en av de två identiska sekvenserna
 *   logga-cell     tom platshållarcell (byts mot <img>-logotyp)
 *
 * Hydration: båda komponenterna renderar identisk DOM för ett givet spelar-värde,
 * och servern kör alltid spelar=false ⇒ ren statisk markup. Ingen Math.random,
 * ingen Date.now — all rullning härleds ur animationsklockan och positionen.
 */

import { useEffect, useRef, useState } from "react";
import { motion, useAnimationFrame } from "framer-motion";

/* ================================ RegTicker ================================ */

const HEX = "0123456789abcdef";
const RULL_INTERVALL = 45; // ms per tecken i rullningen
const STAGGER = 70; // ms mellan landningar, vänster → höger
const BAS_RULL = 420; // ms rullning innan första positionen landar
// Totaltid = (antal tecken − 1) · STAGGER + BAS_RULL ⇒ 8 tecken ≈ 910 ms (~1 s).

export function RegTicker({ varde, spelar }: { varde: string; spelar: boolean }) {
  const [tid, setTid] = useState(-1); // -1 = ingen animation har startat
  const tidRef = useRef(-1);
  const startRef = useRef<number | null>(null);

  const tecken = Array.from(varde);
  const total = tecken.length === 0 ? 0 : (tecken.length - 1) * STAGGER + BAS_RULL;

  // Nollställ när spelar slås av, så att en senare true-flank spelar om från början.
  useEffect(() => {
    if (!spelar) {
      startRef.current = null;
      tidRef.current = -1;
      setTid(-1);
    }
  }, [spelar]);

  useAnimationFrame((t) => {
    if (!spelar || tidRef.current >= total) return;
    if (startRef.current === null) startRef.current = t;
    const forflutet = Math.min(t - startRef.current, total);
    tidRef.current = forflutet;
    setTid(forflutet);
  });

  // spelar=false ⇒ behandla allt som landat (nu = total ⇒ exakt `varde`).
  // spelar=true före första bildrutan ⇒ deterministisk bildruta 0.
  const nu = spelar ? Math.max(tid, 0) : total;

  return (
    <span
      className="ticker-rot"
      style={{
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "pre",
      }}
    >
      {tecken.map((riktigt, i) => {
        // Landat tecken kommer ALLTID direkt ur `varde` — inga kvarhängande fel-tecken.
        let visat = riktigt;
        const landning = i * STAGGER + BAS_RULL;
        if (nu < total && nu < landning) {
          const startIdx = (i * 5 + 3) % HEX.length; // deterministiskt ur positionen
          const steg = Math.floor(nu / RULL_INTERVALL);
          visat = HEX.charAt((startIdx + steg) % HEX.length);
        }
        return (
          <span key={i} className="ticker-tecken">
            {visat}
          </span>
        );
      })}
    </span>
  );
}

/* =============================== LogotypRad =============================== */
/*
 * AKTIVERAS när riktiga kundlogotyper finns — aldrig påhittade. Byt
 * platshållarcellerna mot <img>-logotyper och rendera komponenten i
 * page.tsx under hero.
 */

const ANTAL_CELLER = 6;
const CELL_BREDD = 148; // px
const CELL_HOJD = 52; // px
const MELLANRUM = 24; // px, både mellan celler och mellan sekvenserna
const LOOP_SEKUNDER = 28; // en full sekvensbredd per loop ⇒ lugnt tempo

export function LogotypRad({ spelar }: { spelar: boolean }) {
  const platser = Array.from({ length: ANTAL_CELLER }, (_, i) => i);

  // Två identiska sekvenser: paddingRight = MELLANRUM gör avståndet mellan
  // sista och första cellen lika stort som mellan cellerna, så att en
  // förflyttning på exakt -50 % av spåret (= en sekvensbredd) loopar sömlöst.
  const sekvens = (dubblett: boolean) => (
    <div
      key={dubblett ? "b" : "a"}
      className="logga-sekvens"
      aria-hidden={dubblett}
      style={{
        display: "flex",
        gap: MELLANRUM,
        paddingRight: MELLANRUM,
        flex: "none",
      }}
    >
      {platser.map((i) => (
        <div
          key={i}
          className="logga-cell"
          style={{
            width: CELL_BREDD,
            height: CELL_HOJD,
            flex: "none",
            borderRadius: 10,
            background: "var(--yta-is)",
            border: "1px solid var(--linje)",
          }}
        />
      ))}
    </div>
  );

  return (
    <section
      className="logga-rot"
      style={{ display: "flex", flexDirection: "column", gap: 20 }}
    >
      <p
        className="logga-rubrik"
        style={{
          margin: 0,
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          textAlign: "center",
          color: "var(--ink-svag)",
        }}
      >
        Byråer som kör grundbok
      </p>

      <div className="logga-band" style={{ overflow: "hidden" }}>
        <motion.div
          className="logga-spar"
          style={{ display: "flex", width: "max-content" }}
          initial={false}
          animate={spelar ? { x: ["0%", "-50%"] } : { x: "0%" }}
          transition={
            spelar
              ? { duration: LOOP_SEKUNDER, ease: "linear", repeat: Infinity, repeatType: "loop" }
              : { duration: 0 }
          }
        >
          {sekvens(false)}
          {sekvens(true)}
        </motion.div>
      </div>
    </section>
  );
}
