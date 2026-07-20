"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { plexMono } from "../../_publik/fonter";
import "../app.css";

// Inlösen av klientinbjudan (WP20) — kundappens enda osessionerade yta.
// Länken kommer från byråns konsult; kunden sätter namn + lösenord och
// landar inloggad i appen. En använd eller utgången länk är död.

type Inbjudan = { tenant_namn: string; email: string };

/** Kontrollens utfall. Skillnaden mellan "död länk" och "kom inte fram"
 *  är hela poängen: den första är slutgiltig, den andra går att göra om.
 *  Utan det tredje läget fastnade sidan tyst på "kontrollerar …" så fort
 *  svaret inte var JSON (proxy-sida, 5xx-HTML) eller fetch avvisades. */
type Lage =
  | { steg: "kontrollerar" }
  | { steg: "klar"; inbjudan: Inbjudan }
  | { steg: "dod"; fel: string }
  | { steg: "avbrott"; fel: string };

const NATFEL = "Kunde inte nå servern — kontrollera uppkopplingen och försök igen.";

/** Svarskropp → JSON. Ett svar som inte går att tolka är ett avbrott,
 *  aldrig ett tyst ingenting. */
async function json<T>(r: Response): Promise<T> {
  try {
    return (await r.json()) as T;
  } catch {
    throw new Error(NATFEL);
  }
}

export function InbjudanForm({
  navigera = (url: string) => {
    window.location.href = url;
  },
}: {
  /** Sömmen mot webbläsarens navigering — full omladdning så att
   *  servern ser den nysatta sessionscookien. Testet byter ut den. */
  navigera?: (url: string) => void;
} = {}) {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [lage, setLage] = useState<Lage>({ steg: "kontrollerar" });
  const [forsok, setForsok] = useState(0);
  const [namn, setNamn] = useState("");
  const [losenord, setLosenord] = useState("");
  const [skapar, setSkapar] = useState(false);
  const [fel, setFel] = useState("");
  // Låset måste vara synkront: två submits i samma händelseloop (dubbel-
  // klick, Enter två gånger) hinner båda före omrenderingen som sätter
  // skapar/disabled — och en engångstoken tål inte två inlösenanrop.
  const pagar = useRef(false);

  useEffect(() => {
    if (!token) {
      setLage({ steg: "dod", fel: "Länken saknar inbjudningskod — be er konsult om en ny." });
      return;
    }
    const styr = new AbortController();
    setLage({ steg: "kontrollerar" });
    (async () => {
      try {
        const r = await fetch(`/api/app/inbjudan?token=${encodeURIComponent(token)}`, {
          signal: styr.signal,
        });
        const data = await json<Inbjudan & { fel?: string }>(r);
        if (styr.signal.aborted) return;
        // 4xx = död länk (använd/utgången). 5xx = serverfel, gör om.
        if (r.status >= 500) throw new Error(data.fel ?? NATFEL);
        if (!r.ok) {
          setLage({ steg: "dod", fel: data.fel ?? "Inbjudan är ogiltig." });
          return;
        }
        setLage({ steg: "klar", inbjudan: data });
      } catch (err) {
        if (styr.signal.aborted) return;
        setLage({ steg: "avbrott", fel: err instanceof Error ? err.message : NATFEL });
      }
    })();
    return () => styr.abort();
  }, [token, forsok]);

  const skapaKonto = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      // Inlösen sker EN gång: engångstoken konsumeras av första POST:en,
      // så ett andra anrop skulle bara ge ett dött 422 tillbaka.
      if (pagar.current) return;
      pagar.current = true;
      setFel("");
      setSkapar(true);
      try {
        const r = await fetch("/api/app/inbjudan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, namn, losenord }),
        });
        const data = await json<{ fel?: string }>(r);
        if (!r.ok) throw new Error(data.fel ?? `HTTP ${r.status}`);
        navigera("/app");
      } catch (err) {
        // Bara ett misslyckat försök öppnar för ett nytt — efter en
        // lyckad inlösen är låset kvar tills navigeringen tar över.
        pagar.current = false;
        setFel(err instanceof Error ? err.message : String(err));
        setSkapar(false);
      }
    },
    [token, namn, losenord, navigera],
  );

  return (
    <main className={`app ${plexMono.variable}`}>
      <h1 className="sr-rubrik">Skapa konto i grundbok-appen</h1>
      <header className="app-topp">
        <div>
          <div className="wordmark">
            grund<em>bok</em>
          </div>
          <div className="app-bolag">
            {lage.steg === "klar" ? lage.inbjudan.tenant_namn : "kundapp"}
          </div>
        </div>
      </header>

      <section className="kort">
        {lage.steg === "dod" ? (
          <>
            <h2>Inbjudan gäller inte längre</h2>
            <p className="tyst">{lage.fel}</p>
          </>
        ) : lage.steg === "avbrott" ? (
          <>
            <h2>Kunde inte kontrollera inbjudan</h2>
            <p className="tyst">{lage.fel}</p>
            <button className="primar" type="button" onClick={() => setForsok((n) => n + 1)}>
              Försök igen
            </button>
          </>
        ) : lage.steg === "kontrollerar" ? (
          <p className="tyst">kontrollerar inbjudan …</p>
        ) : (
          <>
            <h2>Välkommen till {lage.inbjudan.tenant_namn}</h2>
            <p className="tyst">
              Din byrå har bjudit in dig att lämna underlag och följa bokföringen.
              Kontot skapas för <strong>{lage.inbjudan.email}</strong>.
            </p>
            <form onSubmit={skapaKonto}>
              <div className="laggtill-rad" style={{ flexDirection: "column" }}>
                <input
                  type="text"
                  value={namn}
                  onChange={(e) => setNamn(e.target.value)}
                  placeholder="Ditt namn"
                  aria-label="Ditt namn"
                  autoComplete="name"
                  autoFocus
                />
                <input
                  type="password"
                  value={losenord}
                  onChange={(e) => setLosenord(e.target.value)}
                  placeholder="Välj lösenord (minst 8 tecken)"
                  aria-label="Lösenord"
                  autoComplete="new-password"
                />
                <button
                  className="primar"
                  type="submit"
                  disabled={skapar || !namn.trim() || losenord.length < 8}
                >
                  {skapar ? "Skapar konto …" : "Skapa konto och öppna appen"}
                </button>
              </div>
            </form>
            {fel && <p className="fel">{fel}</p>}
          </>
        )}
      </section>
    </main>
  );
}

export default function InbjudanSida() {
  return (
    <Suspense>
      <InbjudanForm />
    </Suspense>
  );
}
