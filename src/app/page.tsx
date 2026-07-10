"use client";

import { useState } from "react";
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

function Hero() {
  return (
    <section className="hero">
      <div className="inre">
        <div>
          <span className="overline">Agentisk redovisning · byggd på öppen kärna</span>
          <h1>
            Framtidens redovisning <em>attesterar sig själv</em>
          </h1>
          <p className="ingress">
            Specialistagenter tolkar och konterar era underlag enligt gällande rätt,
            med lagrum på varje förslag. Ingenting bokförs utan att en behörig
            människa attesterat eller er egen policy uttryckligen tillåtit det —
            ansvaret flyttar aldrig.
          </p>
          <a className="cta" href="#vantelista">
            Ställ er på väntelistan
          </a>
        </div>
        <div className="scen-yta">{/* Kedje-scenen monteras här (egen commit). */}</div>
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

function SaFunkarDet() {
  return (
    <section id="sa-funkar-det">
      <div className="inre">
        <SektionHuvud nr="01" titel="Så funkar det" />
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
      <div className="kontakt">
        <p className="tack">Tack — vi hör av oss.</p>
        <p className="tyst">
          Ingen väntelista med automatiska utskick: en människa läser och svarar.
        </p>
      </div>
    );
  }

  return (
    <div className="kontakt">
      <form onSubmit={skicka}>
        <input
          value={namn}
          onChange={(e) => setNamn(e.target.value)}
          placeholder="Ditt namn"
          autoComplete="name"
          required
        />
        <input
          value={byra}
          onChange={(e) => setByra(e.target.value)}
          placeholder="Byrå eller bolag"
          autoComplete="organization"
          required
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-post"
          autoComplete="email"
          required
        />
        <textarea
          value={meddelande}
          onChange={(e) => setMeddelande(e.target.value)}
          placeholder="Vad vill ni lösa? (valfritt)"
        />
        <button
          className="kontakt-skicka"
          type="submit"
          disabled={skickar || !namn.trim() || !byra.trim() || !email.trim()}
        >
          {skickar ? "Skickar …" : "Ställ er på väntelistan"}
        </button>
      </form>
      {fel && <p className="fel">{fel}</p>}
    </div>
  );
}

function Vantelista() {
  return (
    <section id="vantelista">
      <div className="inre">
        <SektionHuvud nr="04" titel="Ställ er på väntelistan" />
        <KontaktBox />
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
    <main className="publik">
      <SajtTopp />
      <Hero />
      <SaFunkarDet />
      <Moduler />
      <Vantelista />
      <SajtFot />
    </main>
  );
}
