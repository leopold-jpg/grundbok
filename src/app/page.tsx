"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import HeroPixlar from "./_publik/HeroPixlar";
import KedjeScen from "./_publik/KedjeScen";
import ArkitekturFigur from "./_publik/ArkitekturFigur";
import {
  IllustrationErData,
  IllustrationSistaOrdet,
  IllustrationSparbart,
} from "./_publik/TrygghetsIllustrationer";
import AttestSimulator from "./_publik/AttestSimulator";
import { PanelAvvikelse, PanelKontering, PanelUnderlag } from "./_publik/StegPaneler";
import BentoModuler from "./_publik/BentoModuler";
import { RegTicker } from "./_publik/TickerOchLogotyper";
import { plexMono } from "./_publik/fonter";
import { useSpelar } from "./_publik/useSpelar";
import "./publik.css";

// Publika sajten — det blivande kunden ser (DESIGN-BRIEF v2: "papper
// som blivit levande"). Ingen riktig data: scenen och exemplen använder
// samma påhittade exempelbolag som demon (src/lib/exempel.ts).
// Kontaktboxen POST:ar till befintliga leads-flödet.

function SajtTopp() {
  return (
    <header className="sajt-topp">
      <div className="inre">
        <a className="wordmark" href="/">
          grund<em>bok</em>
        </a>
        <nav>
          <a href="/login">Logga in</a>
          <a className="topp-cta" href="#vantelista">
            Väntelistan
          </a>
        </nav>
      </div>
    </header>
  );
}

// Hero enligt facit (DESIGN-BRIEF v3): centrerad rubrik + kort copy +
// en CTA, och kedje-scenen som inramad produktskärm direkt under —
// rubriken säger vad, scenen bevisar det.
function Hero() {
  const spelar = useSpelar();
  return (
    <section className="hero">
      <HeroPixlar spelar={spelar} />
      <div className="inre">
        <span className="overline">Agentisk redovisning · byggd på öppen kärna</span>
        <h1>
          Framtidens redovisning <em>attesterar sig själv</em>
        </h1>
        <p className="ingress">
          Specialistagenter tolkar och konterar era underlag enligt gällande rätt,
          med lagrum på varje förslag. Ingenting bokförs utan attest eller er
          uttryckliga policy — ansvaret flyttar aldrig.
        </p>
        <a className="cta" href="#vantelista">
          Ställ er på väntelistan
        </a>
        <div className="scen-yta">
          <KedjeScen />
        </div>
      </div>
    </section>
  );
}

function SektionHuvud({ nr, titel }: { nr: string; titel: string }) {
  return (
    <div className="sektion-huvud">
      <span className="lopnr">{nr}</span>
      <h2>{titel}</h2>
    </div>
  );
}

// Scrolldrivet avslöjande — subtilt (fade/translate), en gång.
// Servern och klienten renderar SAMMA träd (ingen hydration mismatch);
// prefers-reduced-motion neutraliseras i CSS med !important-överstyrning
// av framers inline-stilar. Kedje-hero:n är sajtens enda kontinuerliga
// animation; allt annat är lugnt (DESIGN-BRIEF §Motion).
function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      data-reveal
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

// Visuellt buren sekvens (v4): tre illustrerade paneler med max en
// mening var — illustrationerna bär berättelsen, texten kvitterar.
const STEGEN = [
  {
    rubrik: "Släpp in underlaget",
    text: "Klistra in i dag — mejl, foto och uppladdning är på väg; varje kanal är bara en källa in.",
    Panel: PanelUnderlag,
  },
  {
    rubrik: "Agenterna tolkar och konterar",
    text: "BAS-kontering och momssats med lagrum, konfidens och modellversion på varje förslag.",
    Panel: PanelKontering,
  },
  {
    rubrik: "Ni attesterar bara avvikelserna",
    text: "Rutinen bokför sig själv inom er policy — kön krymper, kontrollen består.",
    Panel: PanelAvvikelse,
  },
] as const;

function SaFunkarDet() {
  const spelar = useSpelar();
  return (
    <section id="sa-funkar-det" className="is-yta">
      <div className="inre">
        <SektionHuvud nr="01" titel="Så funkar det" />
        <div className="panel-grid">
          {STEGEN.map((steg, i) => (
            <Reveal key={steg.rubrik} className="panelen" delay={i * 0.08}>
              <div className="panel-bild">
                <steg.Panel spelar={spelar} />
              </div>
              <span className="panel-nr">{i + 1}</span>
              <h3>{steg.rubrik}</h3>
              <p>{steg.text}</p>
            </Reveal>
          ))}
        </div>
        <Reveal className="krymper">
          <p className="krymper-rad">
            Attesthögen krymper — <em>det är produkten.</em>
          </p>
          {/* Interaktiv (v6): EN slider + öppna antaganden; utfallet är
              ren aritmetik märkt räkneexempel. Ingen kurva. */}
          <AttestSimulator spelar={spelar} />
        </Reveal>
      </div>
    </section>
  );
}

// Förtroendesektionen (v6 §7): trygghet före teknik — tre grafiska
// löften som glass-kort (glass används ENDAST här + navets blur tills
// vidare). Arkitekturdiagrammet lever kvar i en diskret utfällning
// för tekniska granskare. Varje löfte pekar på en mekanism i repot.
const LOFTEN = [
  {
    rubrik: "Er data är er",
    text: "Era underlag används till er bokföring — aldrig till att träna modeller.",
    Illustration: IllustrationErData,
  },
  {
    rubrik: "En människa har sista ordet",
    text: "Ingenting bokförs utan attest eller er uttryckliga policy — och rättelser kräver alltid människa.",
    Illustration: IllustrationSistaOrdet,
  },
  {
    rubrik: "Allt är spårbart",
    text: "Varje beslut loggas med hash, identitet och lagrum — huvudboken är append-only.",
    Illustration: IllustrationSparbart,
  },
] as const;

function Fortroende() {
  const spelar = useSpelar();
  return (
    <section id="fortroende" className="is-yta trygghet">
      <div className="inre">
        <SektionHuvud nr="02" titel="Förtroende är arkitektur" />
        <div className="trygghet-grid">
          {LOFTEN.map((lofte, i) => (
            <Reveal key={lofte.rubrik} className="glass-kort" delay={i * 0.08}>
              <div className="glass-bild" aria-hidden="true">
                <lofte.Illustration spelar={spelar} />
              </div>
              <h3>{lofte.rubrik}</h3>
              <p>{lofte.text}</p>
            </Reveal>
          ))}
        </div>
        <details className="teknik-utfallning">
          <summary>För era tekniska granskare — hela arkitekturen</summary>
          <div className="teknik-innehall">
            <ArkitekturFigur spelar={spelar} />
            <p className="fortroende-rad">
              Hash-bundna beslut, radnivå-isolering per kund, ingen träning på er
              data och mänsklig kontroll som konfigurerbar mekanism — spårbarheten
              AI-förordningen kräver är arkitektur här, inte efterhandskonstruktion.
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}

// Moduler som bento-grid (v5) — live-modulerna stora med levande
// detaljer, kommande dämpade. Byggd i parallell worktree.
function Moduler() {
  const spelar = useSpelar();
  return (
    <section id="moduler" className="is-yta">
      <div className="inre">
        <SektionHuvud nr="03" titel="Moduler" />
        <BentoModuler spelar={spelar} />
      </div>
    </section>
  );
}

// Löpnummer-tickern (v4 §8): rullar medan inskrivningen pågår. Inget
// påhittat nummer landas — API:t exponerar inget id (och API:er ligger
// utanför den hårda gränsen), så kvittensen är verklig mottagningstid.
function NrTicker({ aktiv }: { aktiv: boolean }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!aktiv) return;
    const t = setInterval(() => setTick((n) => n + 1), 60);
    return () => clearInterval(t);
  }, [aktiv]);
  if (!aktiv) return <span className="ticker-nr">reg —</span>;
  const siffror = [0, 1, 2, 3].map((pos) => (tick * 7 + pos * 3) % 10);
  return <span className="ticker-nr">reg {siffror.join("")}</span>;
}

function KontaktBox() {
  const spelar = useSpelar();
  const [namn, setNamn] = useState("");
  const [byra, setByra] = useState("");
  const [email, setEmail] = useState("");
  const [meddelande, setMeddelande] = useState("");
  const [skickar, setSkickar] = useState(false);
  const [skickad, setSkickad] = useState(false);
  const [mottagenKl, setMottagenKl] = useState("");
  const [regId, setRegId] = useState("");
  const [fel, setFel] = useState("");

  async function skicka(e: React.FormEvent) {
    e.preventDefault();
    setFel("");
    setSkickar(true);
    try {
      const r = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ namn, byra, email, meddelande: meddelande || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.fel ?? `HTTP ${r.status}`);
      setRegId(typeof data.id === "string" ? data.id.slice(0, 8) : "");
      setMottagenKl(new Date().toLocaleTimeString("sv-SE"));
      setSkickad(true);
    } catch (err) {
      setFel(err instanceof Error ? err.message : String(err));
      setSkickar(false);
    }
  }

  if (skickad) {
    return (
      <div className="kontakt" role="status">
        <span className="stampel stampel-in">Registrerad</span>
        <p className="tack">Tack — ni är inskrivna.</p>
        <p className="reg-rad">
          {regId && (
            <>
              reg <RegTicker varde={regId} spelar={spelar} /> ·{" "}
            </>
          )}
          mottagen kl {mottagenKl}
        </p>
        <p className="tyst">
          Ingen väntelista med automatiska utskick: en människa läser och svarar.
        </p>
      </div>
    );
  }

  return (
    <div className="kontakt">
      <div className="kontakt-topp">
        <span>Väntelistan</span>
        <NrTicker aktiv={skickar} />
      </div>
      <form onSubmit={skicka}>
        <div className="falt-par">
          <label>
            <span className="falt-etikett">Namn</span>
            <input value={namn} onChange={(e) => setNamn(e.target.value)} autoComplete="name" required />
          </label>
          <label>
            <span className="falt-etikett">Byrå eller bolag</span>
            <input value={byra} onChange={(e) => setByra(e.target.value)} autoComplete="organization" required />
          </label>
        </div>
        <label>
          <span className="falt-etikett">E-post</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label>
          <span className="falt-etikett">Vad vill ni lösa? (valfritt)</span>
          <textarea value={meddelande} onChange={(e) => setMeddelande(e.target.value)} />
        </label>
        <button
          className="kontakt-skicka"
          type="submit"
          disabled={skickar}
        >
          {skickar ? "Skriver in …" : "Ställ er på väntelistan"}
        </button>
      </form>
      <p className="tyst kontakt-not">
        Ingen väntelista med automatiska utskick: en människa läser och svarar.
      </p>
      {fel && (
        <p className="fel" role="alert">
          {fel}
        </p>
      )}
    </div>
  );
}

function Vantelista() {
  return (
    <section id="vantelista">
      <div className="inre">
        <SektionHuvud nr="04" titel="Ställ er på väntelistan" />
        <Reveal>
          <KontaktBox />
        </Reveal>
      </div>
    </section>
  );
}

function SajtFot() {
  return (
    <footer className="sajt-fot">
      <div className="inre">
        <div className="wordmark">
          grund<em>bok</em>
        </div>
        <p>
          Byggd på en öppen kärna. Varje förslag bär modell, promptversion,
          konfidens och lagrum — spårbarheten AI-förordningen kräver är
          arkitektur här, inte efterhandskonstruktion.
        </p>
        <nav>
          <a href="https://github.com/leopold-jpg/grundbok">GitHub</a>
          <a href="#vantelista">Kontakt — väntelistan</a>
          <a href="/login">Logga in</a>
          <span className="upphov">© 2026 Leopold Seifert</span>
        </nav>
      </div>
    </footer>
  );
}

export default function PublikSida() {
  return (
    <main className={`publik ${plexMono.variable}`}>
      <SajtTopp />
      <Hero />
      <SaFunkarDet />
      <Fortroende />
      <Moduler />
      <Vantelista />
      <SajtFot />
    </main>
  );
}
