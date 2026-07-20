"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { plexMono } from "../../_publik/fonter";
import "../app.css";

// Inlösen av klientinbjudan (WP20) — kundappens enda osessionerade yta.
// Länken kommer från byråns konsult; kunden sätter namn + lösenord och
// landar inloggad i appen. En använd eller utgången länk är död.

type Inbjudan = { tenant_namn: string; email: string };

function InbjudanForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [inbjudan, setInbjudan] = useState<Inbjudan | null>(null);
  const [ogiltig, setOgiltig] = useState("");
  const [namn, setNamn] = useState("");
  const [losenord, setLosenord] = useState("");
  const [skapar, setSkapar] = useState(false);
  const [fel, setFel] = useState("");

  useEffect(() => {
    if (!token) {
      setOgiltig("Länken saknar inbjudningskod — be er konsult om en ny.");
      return;
    }
    fetch(`/api/app/inbjudan?token=${encodeURIComponent(token)}`).then(async (r) => {
      const data = await r.json();
      if (!r.ok) {
        setOgiltig((data as { fel?: string }).fel ?? "Inbjudan är ogiltig.");
        return;
      }
      setInbjudan(data as Inbjudan);
    });
  }, [token]);

  async function skapaKonto(e: React.FormEvent) {
    e.preventDefault();
    setFel("");
    setSkapar(true);
    try {
      const r = await fetch("/api/app/inbjudan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, namn, losenord }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error((data as { fel?: string }).fel ?? `HTTP ${r.status}`);
      window.location.href = "/app";
    } catch (err) {
      setFel(err instanceof Error ? err.message : String(err));
      setSkapar(false);
    }
  }

  return (
    <main className={`app ${plexMono.variable}`}>
      <h1 className="sr-rubrik">Skapa konto i grundbok-appen</h1>
      <header className="app-topp">
        <div>
          <div className="wordmark">
            grund<em>bok</em>
          </div>
          <div className="app-bolag">{inbjudan?.tenant_namn ?? "kundapp"}</div>
        </div>
      </header>

      <section className="kort">
        {ogiltig ? (
          <>
            <h2>Inbjudan gäller inte längre</h2>
            <p className="tyst">{ogiltig}</p>
          </>
        ) : !inbjudan ? (
          <p className="tyst">kontrollerar inbjudan …</p>
        ) : (
          <>
            <h2>Välkommen till {inbjudan.tenant_namn}</h2>
            <p className="tyst">
              Din byrå har bjudit in dig att lämna underlag och följa bokföringen.
              Kontot skapas för <strong>{inbjudan.email}</strong>.
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
