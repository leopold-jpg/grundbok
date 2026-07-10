"use client";

import { useState } from "react";
import "./publik.css";

// Publika sajten (WP12) — det blivande kunden ser. Ingen riktig data:
// attestkön nedan är en statisk komponent med exempeldata ur samma
// exempel som demon (src/lib/exempel.ts). Demoflödet bor i /byra.

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
          {skickar ? "Skickar …" : "Jag vill veta mer"}
        </button>
      </form>
      {fel && <p className="fel">{fel}</p>}
    </div>
  );
}

// Statisk attestkö — exempeldata (samma påhittade bolag som demon),
// aldrig riktig data på publika ytan.
function AttestMock() {
  return (
    <div className="attest-mock" aria-label="Exempel på attestkön">
      <div className="mock-rubrik">
        <span className="mock-titel">Att attestera</span>
        <span className="mock-not">exempeldata</span>
      </div>
      <div className="mock-rad">
        <div>
          <div className="motpart">Kafferosteriet Exempel AB</div>
          <div className="avser">Kaffebönor, mörkrost 20 kg · livsmedel 6 %</div>
        </div>
        <span className="belopp">1 060,00 kr</span>
        <span className="mock-knapp">Attestera</span>
        <div className="mock-meta">
          <span className="chip">ML (2023:200) 9 kap.</span>
          <span className="chip">konto 4010 · 2440</span>
        </div>
      </div>
      <div className="mock-rad">
        <div>
          <div className="motpart">Underentreprenad Exempel AB</div>
          <div className="avser">Byggtjänst · omvänd betalningsskyldighet</div>
        </div>
        <span className="belopp">10 000,00 kr</span>
        <span className="mock-knapp">Attestera</span>
        <div className="mock-meta">
          <span className="chip">ML (2023:200) 16 kap. 13 §</span>
          <span className="chip">utanför policy: ny motpart</span>
        </div>
      </div>
      <div className="mock-rad">
        <div>
          <div className="motpart">Kontorsmaterial Exempel AB</div>
          <div className="avser">Återkommande inköp · känd motpart</div>
        </div>
        <span className="belopp">312,50 kr</span>
        <span className="mock-auto">bokförd av policy</span>
      </div>
    </div>
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
    text: "Byråns klienter fotar kvitton, följer status och ställer frågor i en egen app — en förmån byrån ger sina klienter.",
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

export default function PublikSida() {
  return (
    <main className="publik">
      <header className="sajt-topp">
        <div className="wordmark">
          grund<em>bok</em>
        </div>
        <a href="/login">Logga in</a>
      </header>

      <section className="hero">
        <h1>
          Framtidens redovisning sker <em>här</em>
        </h1>
        <p>
          Specialistagenter tolkar och konterar era underlag enligt gällande rätt —
          med lagrum på varje förslag. Ingenting bokförs utan att en behörig människa
          attesterat eller att er egen policy uttryckligen tillåtit det. Ansvaret
          flyttar aldrig.
        </p>
      </section>

      <section>
        <h2>Så funkar det</h2>
        <div className="stegen">
          <div className="steget">
            <span className="nr">1.</span>
            <h3>Släpp in underlaget</h3>
            <p>
              Klistra in eller ladda upp kvitton och fakturor. Mejladress per klient
              och foto via kundappen är på väg — varje kanal är bara en källa in.
            </p>
          </div>
          <div className="steget">
            <span className="nr">2.</span>
            <h3>Agenterna tolkar och konterar</h3>
            <p>
              Kontering, momssats och deklarationsrutor enligt BAS och gällande
              momslag — varje förslag bär lagrum, konfidens och modellversion.
            </p>
          </div>
          <div className="steget">
            <span className="nr">3.</span>
            <h3>Ni attesterar bara avvikelserna</h3>
            <p>
              Rutinhändelser inom er policy bokförs själva, loggade som policybeslut.
              Kön krymper — kontrollen består.
            </p>
          </div>
        </div>
        <AttestMock />
      </section>

      <section>
        <h2>Moduler</h2>
        <div className="moduler">
          {MODULER.map((m) => (
            <div key={m.namn} className="modul">
              <h3>{m.namn}</h3>
              <span className={m.status === "live" ? "status-live" : "status-kommande"}>
                {m.status === "live" ? "live" : "kommande"}
              </span>
              <p>{m.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>Hör av er</h2>
        <KontaktBox />
      </section>

      <footer className="sajt-fot">
        Byggd på en öppen kärna —{" "}
        <a href="https://github.com/leopold-jpg/grundbok">github.com/leopold-jpg/grundbok</a>.
        Varje förslag bär modell, promptversion, konfidens och lagrum: spårbarheten
        AI-förordningen kräver är arkitektur här, inte efterhandskonstruktion.{" "}
        <a href="/login">Logga in</a> för byråns arbetsyta.
      </footer>
    </main>
  );
}
