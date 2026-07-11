"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useSpelar } from "./useSpelar";

// Kedje-hero:n — sajtens huvudnummer (DESIGN-BRIEF §Hero). En lugnt
// loopande produktscen i kod: kvittot glider in → tolkningen skrivs
// fram rad för rad → attestknappen trycks → verifikation 47 stämplas
// med hash. Samma exempeldata som demon (kaffefakturan i 12 %-varianten,
// src/lib/exempel.ts) och samma visuella språk som /byra — scenen ÄR
// produkten. Vid prefers-reduced-motion visas ett stilla slutläge.

const TOLKNING: { etikett: string; varde: string; mono?: boolean }[] = [
  { etikett: "Motpart", varde: "Kafferosteriet Exempel AB" },
  { etikett: "Konto", varde: "4010 · 2641 · 2440", mono: true },
  { etikett: "Moms", varde: "12 % · livsmedel", mono: true },
  { etikett: "Lagrum", varde: "ML (2023:200) 9 kap.", mono: true },
  { etikett: "Konfidens", varde: "0,94", mono: true },
];

const HASH = "9f2c81d4a0b36e75c48d";

// Tidslinjen: steg → millisekunder in i cykeln. Layouten är statisk
// (allt upptar sin plats från start, bara opacity/transform ändras) så
// loopen aldrig får sidan att hoppa.
const TIDSLINJE: [steg: number, vidMs: number][] = [
  [1, 500], // kvittot in
  [2, 1600], // tolkningsrad 1 …
  [3, 2250],
  [4, 2900],
  [5, 3550],
  [6, 4200], // … tolkningsrad 5
  [7, 5000], // attestraden fram
  [8, 6200], // knappen trycks
  [9, 7100], // verifikationen fram, stämpeln slår
  [10, 8200], // hashen skrivs
  [11, 12800], // tona ut, börja om
];

const LUGN = { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const };

function Kvitto({ synligt, tillbakadraget }: { synligt: boolean; tillbakadraget?: boolean }) {
  return (
    <motion.div
      className="kvitto"
      initial={false}
      animate={
        synligt
          ? { opacity: tillbakadraget ? 0.72 : 1, y: 0, rotate: -1, scale: tillbakadraget ? 0.985 : 1 }
          : { opacity: 0, y: -26, rotate: 2, scale: 1 }
      }
      transition={{ ...LUGN, duration: 0.6 }}
    >
      <div className="kvitto-titel">Faktura</div>
      <div className="kvitto-motpart">Kafferosteriet Exempel AB</div>
      <div className="perforering" />
      <div className="kvitto-rad">
        <span>Kaffebönor, mörkrost 20 kg</span>
      </div>
      <div className="kvitto-rad">
        <span>Netto</span>
        <span>1 000,00</span>
      </div>
      <div className="kvitto-rad">
        <span>Moms (12 %)</span>
        <span>120,00</span>
      </div>
      <div className="kvitto-rad summa">
        <span>Att betala</span>
        <span>1 120,00 kr</span>
      </div>
    </motion.div>
  );
}

function Tolkning({ steg }: { steg: number }) {
  return (
    <div className="tolkning">
      {TOLKNING.map((rad, i) => {
        const synlig = steg >= 2 + i;
        const aktiv = steg === 2 + i;
        return (
          <motion.div
            key={rad.etikett}
            className="tolkrad"
            data-aktiv={aktiv}
            initial={false}
            animate={synlig ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
            transition={LUGN}
          >
            <span className="tolk-etikett">{rad.etikett}</span>
            <span className={rad.mono ? "tolk-varde mono" : "tolk-varde"}>{rad.varde}</span>
          </motion.div>
        );
      })}
    </div>
  );
}

function AttestRad({ steg }: { steg: number }) {
  const tryckt = steg >= 8;
  return (
    <motion.div
      className="scen-attest"
      initial={false}
      animate={steg >= 7 ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
      transition={LUGN}
    >
      <motion.span
        className="scen-knapp"
        data-tryckt={tryckt}
        animate={tryckt ? { scale: [1, 0.95, 1] } : { scale: 1 }}
        transition={{ duration: 0.3, times: [0, 0.4, 1], ease: "easeOut" }}
      >
        {tryckt ? "Attesterad" : "Attestera"}
      </motion.span>
      <span className="scen-attest-not">binds till förslagets hash och er identitet</span>
    </motion.div>
  );
}

function Verifikation({ steg, statisk }: { steg: number; statisk?: boolean }) {
  const synlig = statisk || steg >= 9;
  const hashFram = statisk || steg >= 10;
  return (
    <motion.div
      className="scen-verifikation"
      initial={false}
      animate={synlig ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
      // In: vänta tills attest-vyn hunnit tona ner. Ut: direkt.
      transition={{ ...LUGN, duration: 0.6, delay: synlig && !statisk ? 0.35 : 0 }}
      style={{ pointerEvents: "none" }}
    >
      <motion.span
        className="stampel"
        initial={false}
        animate={
          synlig ? { opacity: 1, scale: 1, rotate: -8 } : { opacity: 0, scale: 1.22, rotate: -11 }
        }
        transition={{
          duration: 0.34,
          ease: [0.22, 1, 0.36, 1],
          delay: synlig && !statisk ? 0.85 : 0,
        }}
      >
        Attesterad
      </motion.span>
      <div className="ver-huvud">
        <span className="ver-nr">V47</span>
        <span className="ver-beskr">Kaffebönor, mörkrost 20 kg</span>
      </div>
      <div className="ver-rader">
        <div className="ver-rad">
          <span>4010 Inköp material och varor</span>
          <span>1 000,00</span>
        </div>
        <div className="ver-rad">
          <span>2641 Debiterad ingående moms</span>
          <span>120,00</span>
        </div>
        <div className="ver-rad">
          <span>2440 Leverantörsskulder</span>
          <span>1 120,00</span>
        </div>
      </div>
      <div className="perforering" />
      <div className="ver-hash">
        <span>hash&nbsp;</span>
        {HASH.split("").map((tecken, i) => (
          <motion.span
            key={i}
            initial={false}
            animate={{ opacity: hashFram ? 1 : 0 }}
            transition={{ duration: 0.15, delay: hashFram && !statisk ? i * 0.04 : 0 }}
          >
            {tecken}
          </motion.span>
        ))}
        <span>…</span>
        <span className="ver-appendonly">append-only</span>
      </div>
    </motion.div>
  );
}

export default function KedjeScen() {
  // Servern och första klientrenderingen visar alltid det frusna
  // slutläget (samma träd → ingen hydration mismatch; innehållet syns
  // utan JS). Loopen startar efter montering via useSpelar.
  const spelar = useSpelar();
  const [pausad, setPausad] = useState(false);
  const [steg, setSteg] = useState(0);
  const [cykel, setCykel] = useState(0);

  useEffect(() => {
    if (!spelar || pausad) return;
    const timers = TIDSLINJE.map(([s, t]) => setTimeout(() => setSteg(s), t));
    return () => timers.forEach(clearTimeout);
  }, [cykel, spelar, pausad]);

  // Chrome throttlar timers i bakgrundsflikar — timer och animation
  // driver isär. Börja om från början när fliken blir synlig igen.
  useEffect(() => {
    if (!spelar || pausad) return;
    function synlighet() {
      if (!document.hidden) {
        setSteg(0);
        setCykel((c) => c + 1);
      }
    }
    document.addEventListener("visibilitychange", synlighet);
    return () => document.removeEventListener("visibilitychange", synlighet);
  }, [spelar, pausad]);

  useEffect(() => {
    if (steg !== 11) return;
    const t = setTimeout(() => {
      setSteg(0);
      setCykel((c) => c + 1);
    }, 650);
    return () => clearTimeout(t);
  }, [steg]);

  function vaxlaPaus() {
    if (pausad) {
      // Återuppta från början — en halvfryst kedja är ingen berättelse.
      setSteg(0);
      setCykel((c) => c + 1);
    }
    setPausad(!pausad);
  }

  // Fruset slutläge: kvitto, färdig tolkning (ingen aktiv rad — ingen
  // caret) och stämplad verifikation. Visas vid SSR, före montering och
  // för prefers-reduced-motion.
  if (!spelar) {
    return (
      <div className="scen" role="img" aria-label={SCEN_BESKRIVNING}>
        <div aria-hidden="true" className="scen-inre">
          <ScenHuvud />
          <div className="scen-kropp">
            <div className="scen-flode" style={{ opacity: 0.15 }}>
              <Kvitto synligt />
              <Tolkning steg={7} />
              <AttestRad steg={8} />
            </div>
            <Verifikation steg={10} statisk />
          </div>
        </div>
      </div>
    );
  }

  const visaVerifikation = steg >= 9 && steg < 11;

  return (
    <>
      <div className="scen" role="img" aria-label={SCEN_BESKRIVNING}>
        <div aria-hidden="true" className="scen-inre">
          <ScenHuvud />
          {/* Rubrikraden står kvar; bara kedjans innehåll tonas vid omstart. */}
          <motion.div
            className="scen-kropp"
            initial={false}
            animate={{ opacity: steg === 11 ? 0 : 1 }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
          >
            <motion.div
              className="scen-flode"
              initial={false}
              animate={
                visaVerifikation ? { opacity: 0.08, scale: 0.992 } : { opacity: 1, scale: 1 }
              }
              transition={{ ...LUGN, duration: 0.45 }}
            >
              <Kvitto synligt={steg >= 1} tillbakadraget={steg >= 2} />
              <Tolkning steg={steg} />
              <AttestRad steg={steg} />
            </motion.div>
            <Verifikation steg={steg} />
          </motion.div>
        </div>
      </div>
      {/* Pausmekanism (WCAG 2.2.2) — syskon till scenen, inte inuti
          role="img", så skärmläsare når den. */}
      <button type="button" className="scen-paus" onClick={vaxlaPaus}>
        {pausad ? "Spela upp animationen" : "Pausa animationen"}
      </button>
    </>
  );
}

function ScenHuvud() {
  return (
    <div className="scen-huvud">
      <span className="scen-titel">Att attestera</span>
      <span className="scen-not">exempeldata</span>
    </div>
  );
}

const SCEN_BESKRIVNING =
  "Produktscen med exempeldata: ett kvitto från Kafferosteriet Exempel AB tolkas — " +
  "konto 4010, moms 12 procent enligt ML (2023:200) 9 kap., konfidens 0,94 — " +
  "attesteras och bokförs som verifikation 47, stämplad med sin hash.";
