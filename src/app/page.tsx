"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import HeroPixlar from "./_publik/HeroPixlar";
import KedjeScen from "./_publik/KedjeScen";
import ArkitekturFigur from "./_publik/ArkitekturFigur";
import AttestSimulator from "./_publik/AttestSimulator";
import { PanelAvvikelse, PanelKontering, PanelUnderlag } from "./_publik/StegPaneler";
import {
  IkonBokforing,
  IkonBokslut,
  IkonKundapp,
  IkonLoner,
  IkonRadgivning,
  IkonSkatt,
} from "./_publik/ModulIkoner";
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
    <section id="sa-funkar-det">
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
          {/* Interaktiv: besökarens egna tal driver rutnät och kurva —
              inga påhittade procentsatser (v4 §4). */}
          <AttestSimulator spelar={spelar} />
        </Reveal>
      </div>
    </section>
  );
}

// Förtroendesektionen (v4 §5): EN ritad arkitekturfigur bär de fyra
// poängerna som etiketter i flödet förslag → hash → attest/policy →
// append-only huvudbok. En rad brödtext under — inte fyra stycken.
// (Mörk/ljus-jämförelsen från v3 är avgjord: ljus; historiken finns i git.)
function Fortroende() {
  const spelar = useSpelar();
  return (
    <section id="fortroende">
      <div className="inre">
        <SektionHuvud nr="02" titel="Förtroende är arkitektur" />
        <Reveal>
          <ArkitekturFigur spelar={spelar} />
        </Reveal>
        <p className="fortroende-rad">
          Hash-bundna beslut, radnivå-isolering per kund, ingen träning på er
          data och mänsklig kontroll som konfigurerbar mekanism — spårbarheten
          AI-förordningen kräver är arkitektur här, inte efterhandskonstruktion.
        </p>
      </div>
    </section>
  );
}

// Moduler som ikonkort (v4 §7) i panelernas illustrationsspråk —
// live i full färg, kommande dämpade. Max en mening per modul; samma
// ärliga innehåll som tidigare, bara kortare.
const MODULER = [
  {
    namn: "Bokföring",
    status: "live",
    text: "Underlag in — BAS-kontering och momssats med lagrum, direkt i attestkön.",
    Ikon: IkonBokforing,
  },
  {
    namn: "Rådgivning",
    status: "live",
    text: "Svar om konton, moms och lagrum — alltid med källa och konfidens.",
    Ikon: IkonRadgivning,
  },
  {
    namn: "Kundappen",
    status: "kommande",
    text: "Era kunder fotar kvittot — det bokför sig självt.",
    Ikon: IkonKundapp,
  },
  {
    namn: "Löner",
    status: "kommande",
    text: "Rådgivning först, kontering sen — vi integrerar i stället för att bygga en egen beräkningsmotor.",
    Ikon: IkonLoner,
  },
  {
    namn: "Bokslut",
    status: "kommande",
    text: "Periodiseringar och avstämningar som förslag i samma attestväg.",
    Ikon: IkonBokslut,
  },
  {
    namn: "Skatt & juridik",
    status: "kommande",
    text: "Fler rättskällor på samma rådgivningsgrund — alltid med lagrum.",
    Ikon: IkonSkatt,
  },
] as const;

function Moduler() {
  return (
    <section id="moduler">
      <div className="inre">
        <SektionHuvud nr="03" titel="Moduler" />
        <div className="modul-grid">
          {MODULER.map((modul, i) => (
            <Reveal
              key={modul.namn}
              className="modulkort"
              delay={i * 0.05}
            >
              <div data-status={modul.status} className="modulkort-inre">
                <div className="modul-ikon" aria-hidden="true">
                  <modul.Ikon />
                </div>
                <div className="modul-huvud">
                  <h3>{modul.namn}</h3>
                  <span className="modul-status" data-live={modul.status === "live"}>
                    {modul.status === "live" ? "Live" : "Kommande"}
                  </span>
                </div>
                <p>{modul.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
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
  if (!aktiv) return <span>№ —</span>;
  const siffror = [0, 1, 2, 3].map((pos) => (tick * 7 + pos * 3) % 10);
  return <span>№ {siffror.join("")}</span>;
}

function KontaktBox() {
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
          {regId && <>reg {regId} · </>}mottagen kl {mottagenKl}
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
