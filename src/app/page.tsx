"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import HeroPixlar from "./_publik/HeroPixlar";
import KedjeScen from "./_publik/KedjeScen";
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

// Kurvan som illustrerar att attesthögen krymper. Ren illustration —
// inga påhittade siffror, därför inga skalstreck. Reduced motion får
// hela linjen direkt via CSS (stroke-dasharray-överstyrning).
function AttestKurva() {
  return (
    <figure className="kurva" aria-label="Illustration: andelen som kräver attest sjunker över tid">
      <svg viewBox="0 0 560 150" role="presentation" focusable="false">
        <line x1="4" y1="140" x2="556" y2="140" className="kurva-axel" />
        <motion.path
          d="M 8 24 C 120 32, 200 64, 290 96 S 470 126, 552 131"
          className="kurva-linje"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <figcaption>
        <span>andel som kräver attest</span>
        <span>tid →</span>
      </figcaption>
    </figure>
  );
}

const STEGEN: { rubrik: string; text: string; kanaler?: string[] }[] = [
  {
    rubrik: "Släpp in underlaget",
    text: "Klistra in era kvitton och fakturor i dag — uppladdning, mejladress per klient och foto via kundappen är på väg. Varje kanal är bara en källa in.",
    kanaler: ["Mejl", "Foto", "API"],
  },
  {
    rubrik: "Agenterna tolkar och konterar",
    text: "Kontering, momssats och deklarationsrutor enligt BAS och gällande momslag — varje förslag bär lagrum, konfidens och modellversion.",
  },
  {
    rubrik: "Ni attesterar bara avvikelserna",
    text: "Rutinhändelser inom er policy bokförs själva, loggade som policybeslut. Kön krymper — kontrollen består.",
  },
];

function SaFunkarDet() {
  return (
    <section id="sa-funkar-det">
      <div className="inre">
        <SektionHuvud nr="01" titel="Så funkar det" />
        <div className="steg-lista">
          {STEGEN.map((steg, i) => (
            <Reveal key={steg.rubrik} className="steget" delay={i * 0.06}>
              <span className="steg-siffra">{i + 1}</span>
              <div>
                <h3>{steg.rubrik}</h3>
                <p>{steg.text}</p>
                {steg.kanaler && (
                  <div className="kanaler">
                    {steg.kanaler.map((kanal) => (
                      <div key={kanal} className="kanal">
                        {/* ASSET: stiliserade kvittofoton (genereras separat,
                            DESIGN-BRIEF §Assets) — solid platshållaryta tills dess. */}
                        <div className="kanal-yta" />
                        <span className="kanal-namn">{kanal}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal className="krymper">
          <p className="krymper-rad">
            Attesthögen krymper — <em>det är produkten.</em>
          </p>
          <AttestKurva />
        </Reveal>
      </div>
    </section>
  );
}

// Det som säljer till en försiktig byrå — varje ruta pekar på en
// mekanism i systemet (hash-beslut, RLS, autonomipolicy) eller ett
// uttryckligt åtagande. Inga påhittade garantier.
const FAKTA: { rubrik: string; text: string }[] = [
  {
    rubrik: "Hash-bundna beslut",
    text: "Varje förslag hashas, och attesten binds till hashen och beslutsfattarens identitet. En ändrad rad gör förslaget obeslutbart. Huvudboken är append-only — fel rättas med rättelsepost, aldrig genom ändring.",
  },
  {
    rubrik: "Radnivå-isolering per kund",
    text: "Varje klients data ligger bakom radnivåsäkerhet i databasen. En byrå ser aldrig en annan byrås värld — och operatören ser drift, aldrig kvitton eller kunddata.",
  },
  {
    rubrik: "Ingen träning på er data",
    text: "Era underlag och beslut används till er bokföring — ingenting används för att träna modeller.",
  },
  {
    rubrik: "Mänsklig kontroll som mekanism",
    text: "Human oversight enligt AI-förordningen är en konfigurerbar policy per kund och modul, inte en policytext. Varje förslag bär modell, promptversion, konfidens och lagrum.",
  },
];

// Mörk/ljus-jämförelsen: brief v3 säger ljus (typografiskt buren).
// Växla till "mork" här — eller checka ut commiten före denna — för
// att se den inverterade varianten sida vid sida i browsern.
const FORTROENDE_VARIANT: "mork" | "ljus" = "ljus";

function Fortroende() {
  return (
    <section
      id="fortroende"
      className={FORTROENDE_VARIANT === "mork" ? "morkt" : "fortroende-ljus"}
    >
      <div className="inre">
        <SektionHuvud nr="02" titel="Förtroende är arkitektur" />
        <div className="fakta-grid">
          {FAKTA.map((fakta, i) => (
            <Reveal key={fakta.rubrik} className="faktaruta" delay={i * 0.05}>
              <span className="fakta-nr">№ 0{i + 1}</span>
              <h3>{fakta.rubrik}</h3>
              <p>{fakta.text}</p>
            </Reveal>
          ))}
        </div>
        <div className="oppen-karna">
          <p>Byggd på en öppen kärna — läs koden själv.</p>
          <a href="https://github.com/leopold-jpg/grundbok">github.com/leopold-jpg/grundbok</a>
        </div>
      </div>
    </section>
  );
}

const MODULER: { namn: string; status: "live" | "kommande"; text: string }[] = [
  {
    namn: "Bokföring",
    status: "live",
    text: "Underlag in → tolkning, BAS-kontering och momssats med lagrum → förslag i attestkön. Momsreglerna är versionerade: satsen följer affärshändelsedatumet.",
  },
  {
    namn: "Rådgivning",
    status: "live",
    text: "Frågor om konton, moms och lagrum — svar med källhänvisning och konfidens, aldrig utan.",
  },
  {
    namn: "Kundappen",
    status: "kommande",
    text: "Era kunder fotar kvittot — det bokför sig självt. Byråns klienter följer status och ställer frågor i en egen app, en förmån byrån ger sina klienter.",
  },
  {
    namn: "Löner",
    status: "kommande",
    text: "Stegvis: rådgivning först, kontering sen. Ingen egen beräkningsmotor — vi integrerar.",
  },
  {
    namn: "Bokslut",
    status: "kommande",
    text: "Periodiseringar och avstämningar som förslag, samma attestväg som allt annat.",
  },
  {
    namn: "Skatt & juridik",
    status: "kommande",
    text: "Fler rättskällor på samma rådgivningsgrund — alltid med lagrum.",
  },
];

function Moduler() {
  return (
    <section id="moduler">
      <div className="inre">
        <SektionHuvud nr="03" titel="Moduler" />
        <div className="modul-lista">
          {MODULER.map((modul, i) => (
            <Reveal key={modul.namn} className="modulrad" delay={i * 0.04}>
              <span className="modul-nr">{String(i + 1).padStart(2, "0")}</span>
              <div className="modul-namnrad">
                <h3>{modul.namn}</h3>
                <span className="modul-status" data-live={modul.status === "live"}>
                  {modul.status === "live" ? "Live" : "Kommande"}
                </span>
              </div>
              <p>{modul.text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function KontaktBox() {
  const [namn, setNamn] = useState("");
  const [byra, setByra] = useState("");
  const [email, setEmail] = useState("");
  const [meddelande, setMeddelande] = useState("");
  const [skickar, setSkickar] = useState(false);
  const [skickad, setSkickad] = useState(false);
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
      setSkickad(true);
    } catch (err) {
      setFel(err instanceof Error ? err.message : String(err));
      setSkickar(false);
    }
  }

  if (skickad) {
    return (
      <div className="kontakt" role="status">
        <span className="stampel">Mottagen</span>
        <p className="tack">Tack — vi hör av oss.</p>
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
        <span>№ —</span>
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
          {skickar ? "Skickar …" : "Ställ er på väntelistan"}
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
