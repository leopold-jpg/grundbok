"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { plexMono } from "../_publik/fonter";
import "./app.css";

// Kundappen (WP22) — klientbolagets kommunikationsväg: fota kvitton,
// följ resan (stämplarna Mottaget → Tolkat → Bokfört), fråga om egna
// underlag. Begriplig på fem sekunder: tre ytor, en hero-handling.
// Status via polling i v1 (Realtime är S4+). Appen ser ALDRIG
// konteringar, attestkö eller andra bolag — allt scopas server-side ur
// klientsessionen.

type Session = { anvandare_id: string; namn: string; bolag: string; visa_resultat: boolean };

type Underlag = {
  id: string;
  kalla: string;
  filnamn: string | null;
  skapad: string;
  status: "mottaget" | "tolkat" | "bokfort";
  tolkat_at: string | null;
  bokfort_at: string | null;
  motpart: string | null;
  summary: string | null;
  belopp_ore: number | null;
  verifikationsnummer: number | null;
};

type Laget = {
  inlamnat_manad: number;
  vantar: number;
  senast_bokfort: {
    summary: string | null;
    motpart: string | null;
    bokfort_at: string | null;
    verifikationsnummer: number | null;
  } | null;
};

type AssistentSvar = {
  svar: string;
  typ: string;
  erbjud_eskalering: boolean;
  underlag_id: string | null;
};

type ChattInlagg = {
  roll: "klient" | "assistent";
  text: string;
  /** Ursprungsfrågan + ev. underlag — behövs när eskalering erbjuds. */
  eskalering?: { fraga: string; underlag_id: string | null } | null;
};

type Kundfraga = {
  id: string;
  fraga: string;
  status: "open" | "besvarad";
  svar: string | null;
  skapad: string;
  underlag_summary: string | null;
};

type Avsandare = { id: string; email: string };

const POLL_MS = 15_000;

async function hamta<T>(url: string): Promise<T | null> {
  const r = await fetch(url);
  if (r.status === 401 || r.status === 403) {
    window.location.href = "/login?next=/app";
    return null;
  }
  if (!r.ok) return null;
  return (await r.json()) as T;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.status === 401) {
    window.location.href = "/login?next=/app";
    throw new Error("sessionen har gått ut");
  }
  const data = await r.json();
  if (!r.ok) {
    const fel = (data as { fel?: string }).fel;
    throw new Error(fel ?? `HTTP ${r.status}`);
  }
  return data as T;
}

const datum = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("sv-SE", { day: "numeric", month: "short" }) : "";

const kr = (ore: number) =>
  (ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ------------------------------------------------------------ stämplar

/** Resan som stämplar: nådda steg fyllda, senaste lätt roterad, onådda
 *  streckade. Bokfört är grönt — grönt är ENDAST status. */
function Stamplar({ rad }: { rad: Underlag }) {
  const steg = [
    { namn: "Mottaget", nadd: true, klass: "" },
    { namn: "Tolkat", nadd: rad.status !== "mottaget", klass: "" },
    { namn: "Bokfört", nadd: rad.status === "bokfort", klass: "bokford" },
  ];
  const senast = steg.reduce((s, x, i) => (x.nadd ? i : s), 0);
  return (
    <span className="stampelrad">
      {steg.map((s, i) => (
        <span key={s.namn} style={{ display: "contents" }}>
          {i > 0 && (
            <span className="stampel-pil" aria-hidden="true">
              →
            </span>
          )}
          <span
            className={`stampel ${s.klass}`}
            data-nadd={s.nadd}
            data-senast={i === senast}
          >
            {s.namn}
          </span>
        </span>
      ))}
    </span>
  );
}

// -------------------------------------------------------------- läget

function LagetYta({ laget }: { laget: Laget | null }) {
  const manad = new Date().toLocaleString("sv-SE", { month: "long" });
  return (
    <section className="kort">
      <h2>Läget</h2>
      {!laget ? (
        <p className="tyst">laddar …</p>
      ) : (
        <div className="laget-siffror">
          <div className="siffra">
            <div className="varde">{laget.inlamnat_manad}</div>
            <div className="etikett">Inlämnat i {manad}</div>
          </div>
          <div className="siffra">
            <div className="varde">{laget.vantar}</div>
            <div className="etikett">Väntar på hantering</div>
          </div>
          <div className="siffra senast-bokfort">
            {laget.senast_bokfort ? (
              <>
                <div className="varde">{datum(laget.senast_bokfort.bokfort_at)}</div>
                <div className="etikett">Senast bokfört</div>
                <div className="beskrivning">
                  {laget.senast_bokfort.motpart ?? ""} —{" "}
                  {laget.senast_bokfort.summary ?? ""}
                </div>
              </>
            ) : (
              <>
                <div className="varde">—</div>
                <div className="etikett">Senast bokfört</div>
                <div className="beskrivning">Inget bokfört ännu.</div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------- skicka in

const BILD_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BILDSIDA = 1600;

function filSomDataUrl(fil: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lasare = new FileReader();
    lasare.onload = () => resolve(String(lasare.result));
    lasare.onerror = () => reject(new Error("Filen kunde inte läsas"));
    lasare.readAsDataURL(fil);
  });
}

/** Kamerabilder skalas ned klient-side (max 1600 px, JPEG) — ett
 *  12 MP-foto är onödigt tungt för ett kvitto. PDF skickas som den är.
 *  Okänt bildformat (t.ex. HEIC i äldre webbläsare) ger ärligt fel. */
async function beredFil(fil: File): Promise<{ base64: string; mime: string; filnamn: string }> {
  if (fil.type === "application/pdf") {
    const dataUrl = await filSomDataUrl(fil);
    return {
      base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
      mime: "application/pdf",
      filnamn: fil.name || "underlag.pdf",
    };
  }
  try {
    const bitmap = await createImageBitmap(fil);
    const skala = Math.min(1, MAX_BILDSIDA / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * skala);
    canvas.height = Math.round(bitmap.height * skala);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return {
      base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
      mime: "image/jpeg",
      filnamn: fil.name || "kvitto.jpg",
    };
  } catch {
    if (BILD_MIME.has(fil.type)) {
      const dataUrl = await filSomDataUrl(fil);
      return {
        base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
        mime: fil.type,
        filnamn: fil.name || "kvitto",
      };
    }
    throw new Error("Formatet stöds inte — ta bilden med kameran (JPEG) eller välj en PDF.");
  }
}

function SkickaYta({
  underlag,
  onNytt,
}: {
  underlag: Underlag[];
  onNytt: () => Promise<void>;
}) {
  const [skickar, setSkickar] = useState(false);
  const [kvittens, setKvittens] = useState("");
  const [fel, setFel] = useState("");
  const [sok, setSok] = useState("");
  const [manad, setManad] = useState("alla");
  const kameraRef = useRef<HTMLInputElement>(null);
  const filRef = useRef<HTMLInputElement>(null);

  const [mejladress, setMejladress] = useState("");
  const [avsandare, setAvsandare] = useState<Avsandare[]>([]);
  const [nyAvsandare, setNyAvsandare] = useState("");

  const laddaAvsandare = useCallback(async () => {
    const svar = await hamta<{ mejladress: string; avsandare: Avsandare[] }>(
      "/api/app/avsandare",
    );
    if (svar) {
      setMejladress(svar.mejladress);
      setAvsandare(svar.avsandare);
    }
  }, []);
  useEffect(() => {
    laddaAvsandare();
  }, [laddaAvsandare]);

  async function laddaUpp(fil: File) {
    setFel("");
    setKvittens("");
    setSkickar(true);
    try {
      const beredd = await beredFil(fil);
      const svar = await post<{ dubblett: boolean; notis: string | null }>("/api/intake", {
        fil: beredd,
      });
      setKvittens(
        svar.dubblett
          ? (svar.notis ?? "Samma underlag är redan inlämnat.")
          : "Mottaget! Underlaget ligger nu hos din byrå — följ resan nedan.",
      );
      await onNytt();
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    } finally {
      setSkickar(false);
      if (kameraRef.current) kameraRef.current.value = "";
      if (filRef.current) filRef.current.value = "";
    }
  }

  async function laggTillAvsandare() {
    if (!nyAvsandare.trim()) return;
    setFel("");
    try {
      await post("/api/app/avsandare", { email: nyAvsandare });
      setNyAvsandare("");
      await laddaAvsandare();
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    }
  }

  async function taBort(id: string) {
    setFel("");
    try {
      const r = await fetch("/api/app/avsandare", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) throw new Error(((await r.json()) as { fel?: string }).fel ?? "kunde inte ta bort");
      await laddaAvsandare();
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    }
  }

  // Sök på motpart/text + månad (kickoffen: sökbar på motpart/månad).
  const manader = useMemo(() => {
    const set = new Map<string, string>();
    for (const u of underlag) {
      const d = new Date(u.skapad);
      const nyckel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      set.set(nyckel, d.toLocaleString("sv-SE", { month: "long", year: "numeric" }));
    }
    return [...set.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [underlag]);

  const filtrerade = useMemo(() => {
    const q = sok.trim().toLowerCase();
    return underlag.filter((u) => {
      if (manad !== "alla") {
        const d = new Date(u.skapad);
        const nyckel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (nyckel !== manad) return false;
      }
      if (!q) return true;
      return [u.motpart, u.summary, u.filnamn]
        .filter(Boolean)
        .some((s) => s!.toLowerCase().includes(q));
    });
  }, [underlag, sok, manad]);

  return (
    <>
      <section className="kort">
        <h2>Skicka in</h2>
        <input
          ref={kameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const fil = e.target.files?.[0];
            if (fil) void laddaUpp(fil);
          }}
        />
        <input
          ref={filRef}
          type="file"
          accept="image/*,application/pdf"
          hidden
          onChange={(e) => {
            const fil = e.target.files?.[0];
            if (fil) void laddaUpp(fil);
          }}
        />
        <button
          className="kamera-knapp"
          onClick={() => kameraRef.current?.click()}
          disabled={skickar}
        >
          <svg width="40" height="40" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <rect x="6" y="14" width="36" height="26" rx="3" stroke="currentColor" strokeWidth="1.5" />
            <path d="M17 14l3-6h8l3 6" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="24" cy="27" r="8" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          {skickar ? "Skickar …" : "Fota kvitto"}
        </button>
        <button className="valj-fil" onClick={() => filRef.current?.click()} disabled={skickar}>
          … eller välj en bild/PDF från telefonen
        </button>
        {kvittens && (
          <div className="kvittens" role="status">
            {kvittens}
          </div>
        )}
        {fel && <p className="fel">{fel}</p>}
      </section>

      <section className="kort">
        <h2>Dina underlag</h2>
        <div className="sokrad">
          <input
            type="search"
            value={sok}
            onChange={(e) => setSok(e.target.value)}
            placeholder="Sök motpart …"
            aria-label="Sök på motpart"
          />
          <select value={manad} onChange={(e) => setManad(e.target.value)} aria-label="Filtrera på månad">
            <option value="alla">alla månader</option>
            {manader.map(([nyckel, namn]) => (
              <option key={nyckel} value={nyckel}>
                {namn}
              </option>
            ))}
          </select>
        </div>
        {filtrerade.length === 0 ? (
          <p className="tyst">
            {underlag.length === 0
              ? "Inget inlämnat ännu — fota ditt första kvitto ovan."
              : "Inget underlag matchar sökningen."}
          </p>
        ) : (
          <ul className="historik">
            {filtrerade.map((u) => (
              <li key={u.id}>
                <div className="underlag-rubrik">
                  <span className="motpart">
                    {u.motpart ?? u.filnamn ?? "Väntar på tolkning"}
                    {u.belopp_ore ? ` · ${kr(u.belopp_ore)} kr` : ""}
                  </span>
                  <time dateTime={u.skapad}>{datum(u.skapad)}</time>
                </div>
                {u.summary && <div className="underlag-beskrivning">{u.summary}</div>}
                <Stamplar rad={u} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="kort">
        <h2>Mejla in kvitton</h2>
        <p className="tyst">
          Vidarebefordra fakturor till bolagets adress — men bara från adresser du
          registrerat här. Övriga avsändare stoppas.
        </p>
        <div className="mejladress">{mejladress || "…"}</div>
        {avsandare.map((a) => (
          <div key={a.id} className="avsandare-rad">
            <span>{a.email}</span>
            <button onClick={() => void taBort(a.id)}>ta bort</button>
          </div>
        ))}
        <div className="laggtill-rad">
          <input
            type="email"
            value={nyAvsandare}
            onChange={(e) => setNyAvsandare(e.target.value)}
            placeholder="din.adress@bolaget.se"
            aria-label="Ny avsändaradress"
            onKeyDown={(e) => {
              if (e.key === "Enter") void laggTillAvsandare();
            }}
          />
          <button className="primar" onClick={() => void laggTillAvsandare()} disabled={!nyAvsandare.trim()}>
            Registrera
          </button>
        </div>
      </section>
    </>
  );
}

// --------------------------------------------------------------- fråga

function FragaYta({
  lagringsnyckel,
  fragor,
  onEskalerad,
}: {
  lagringsnyckel: string;
  fragor: Kundfraga[];
  onEskalerad: () => Promise<void>;
}) {
  const [historik, setHistorik] = useState<ChattInlagg[]>([]);
  const [fraga, setFraga] = useState("");
  const [svarar, setSvarar] = useState(false);
  const [fel, setFel] = useState("");

  useEffect(() => {
    try {
      const sparad = sessionStorage.getItem(lagringsnyckel);
      setHistorik(sparad ? (JSON.parse(sparad) as ChattInlagg[]) : []);
    } catch {
      setHistorik([]);
    }
  }, [lagringsnyckel]);

  function spara(nya: ChattInlagg[]) {
    setHistorik(nya);
    try {
      sessionStorage.setItem(lagringsnyckel, JSON.stringify(nya));
    } catch {
      // sessionStorage full/avstängd — chatten lever vidare i minnet.
    }
  }

  async function stall() {
    const q = fraga.trim();
    if (!q) return;
    const medFraga: ChattInlagg[] = [...historik, { roll: "klient", text: q }];
    spara(medFraga);
    setFraga("");
    setSvarar(true);
    setFel("");
    try {
      const r = await post<AssistentSvar>("/api/app/fraga", { fraga: q });
      spara([
        ...medFraga,
        {
          roll: "assistent",
          text: r.svar,
          eskalering: r.erbjud_eskalering ? { fraga: q, underlag_id: r.underlag_id } : null,
        },
      ]);
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    } finally {
      setSvarar(false);
    }
  }

  async function eskalera(inlagg: ChattInlagg, index: number) {
    if (!inlagg.eskalering) return;
    setFel("");
    try {
      const r = await post<{ svar: string }>("/api/app/fraga", {
        fraga: inlagg.eskalering.fraga,
        underlag_id: inlagg.eskalering.underlag_id ?? undefined,
        eskalera: true,
      });
      const nya = [...historik];
      nya[index] = { ...inlagg, eskalering: null };
      spara([...nya, { roll: "assistent", text: r.svar }]);
      await onEskalerad();
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <section className="kort">
        <h2>Fråga</h2>
        <p className="tyst">
          Jag svarar om era egna underlag och verifikat — aldrig med råd. Rådfrågor
          skickar jag vidare till din revisor.
        </p>
        <div className="chatt-historik">
          {historik.map((m, i) => (
            <div key={i} className={`bubbla ${m.roll}`}>
              {m.text}
              {m.eskalering && (
                <button className="eskalera" onClick={() => void eskalera(m, i)}>
                  Ja — skicka till min revisor
                </button>
              )}
            </div>
          ))}
          {svarar && <p className="tyst">svarar …</p>}
        </div>
        <div className="chatt-rad">
          <input
            type="text"
            value={fraga}
            onChange={(e) => setFraga(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !svarar) void stall();
            }}
            placeholder='T.ex. "vad var fakturan från Kafferosteriet i mars?"'
            aria-label="Din fråga"
          />
          <button className="primar" onClick={() => void stall()} disabled={svarar || !fraga.trim()}>
            Fråga
          </button>
        </div>
        {fel && <p className="fel">{fel}</p>}
      </section>

      {fragor.length > 0 && (
        <section className="kort">
          <h2>Frågor hos byrån</h2>
          {fragor.map((f) => (
            <div key={f.id} className="fraga-rad">
              <div className="fraga-status">
                {f.status === "besvarad" ? "besvarad" : "väntar på svar"} · {datum(f.skapad)}
              </div>
              <div className="fraga-text">{f.fraga}</div>
              {f.underlag_summary && <div className="tyst">Gäller: {f.underlag_summary}</div>}
              {f.svar && <div className="fraga-svar">Svar från byrån: {f.svar}</div>}
            </div>
          ))}
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------- sida

const FLIKAR = [
  { id: "laget", namn: "Läget" },
  { id: "skicka", namn: "Skicka in" },
  { id: "fraga", namn: "Fråga" },
] as const;
type FlikId = (typeof FLIKAR)[number]["id"];

export default function KundApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [flik, setFlik] = useState<FlikId>("laget");
  const [underlag, setUnderlag] = useState<Underlag[]>([]);
  const [laget, setLaget] = useState<Laget | null>(null);
  const [fragor, setFragor] = useState<Kundfraga[]>([]);

  const laddaAllt = useCallback(async () => {
    const [u, l, f] = await Promise.all([
      hamta<Underlag[]>("/api/app/underlag"),
      hamta<Laget>("/api/app/laget"),
      hamta<Kundfraga[]>("/api/app/fraga"),
    ]);
    if (u) setUnderlag(u);
    if (l) setLaget(l);
    if (f) setFragor(f);
  }, []);

  useEffect(() => {
    hamta<Session>("/api/app/session").then((s) => {
      if (s) setSession(s);
    });
  }, []);

  // Polling (v1): färsk status var 15:e sekund när fliken är synlig —
  // stämplarna ska röra sig utan att kunden drar för att uppdatera.
  useEffect(() => {
    if (!session) return;
    laddaAllt();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") laddaAllt();
    }, POLL_MS);
    const paSynlig = () => {
      if (document.visibilityState === "visible") laddaAllt();
    };
    document.addEventListener("visibilitychange", paSynlig);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", paSynlig);
    };
  }, [session, laddaAllt]);

  async function loggaUt() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  if (!session) {
    return (
      <main className={`app ${plexMono.variable}`}>
        <p className="tyst">laddar …</p>
      </main>
    );
  }

  const oppnaFragor = fragor.filter((f) => f.status === "open").length;

  return (
    <main className={`app ${plexMono.variable}`}>
      <h1 className="sr-rubrik">grundbok kundapp — {session.bolag}</h1>
      <header className="app-topp">
        <div>
          <div className="wordmark">
            grund<em>bok</em>
          </div>
          <div className="app-bolag">{session.bolag}</div>
        </div>
        <button onClick={() => void loggaUt()}>Logga ut</button>
      </header>

      {flik === "laget" && <LagetYta laget={laget} />}
      {flik === "skicka" && <SkickaYta underlag={underlag} onNytt={laddaAllt} />}
      {flik === "fraga" && (
        <FragaYta
          lagringsnyckel={`grundbok_app_chatt_${session.anvandare_id}`}
          fragor={fragor}
          onEskalerad={laddaAllt}
        />
      )}

      <nav className="app-flikar" aria-label="Appens ytor">
        {FLIKAR.map((f) => (
          <button
            key={f.id}
            className="app-flik"
            data-aktiv={flik === f.id}
            onClick={() => setFlik(f.id)}
          >
            {f.namn}
            {f.id === "fraga" && oppnaFragor > 0 && <span className="antal">{oppnaFragor}</span>}
          </button>
        ))}
      </nav>
    </main>
  );
}
