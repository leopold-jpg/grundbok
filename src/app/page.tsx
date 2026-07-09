"use client";

import { useCallback, useEffect, useState } from "react";

type Tenant = { id: string; namn: string; mall: string };
type Exempel = { id: string; label: string; tenant: string; text: string };
type Status = { motor: "anthropic" | "fallback"; modell: string; detalj: string };

type Extraktion = {
  motpart: string;
  beskrivning: string;
  datum: string;
  netto_ore: number;
  moms_ore: number | null;
  brutto_ore: number | null;
  momssats_angiven: number | null;
  kategori: string;
  betalsatt: "faktura" | "direkt";
};

type Tolkning = {
  document_id: string;
  extraktion: Extraktion;
  motor: "anthropic" | "fallback";
  motor_detalj: string;
  injektionsfynd: { monster: string; utdrag: string }[];
};

type Rad = { konto: string; kontonamn: string; debet_ore: number; kredit_ore: number };
type Flagga = { id: string; niva: string; text: string };

type ForslagSvar = {
  proposal_id: string;
  status: "pending" | "auto_approved";
  hash: string;
  confidence: number;
  missade_villkor: string[];
  verifikation: { id: string; nummer: number; extern_ref: string } | null;
  forslag: {
    rader: Rad[];
    affarshandelsedatum: string;
    netto_ore: number;
    brutto_ore: number;
    moms: {
      typ: string;
      sats: number;
      lagrum: string;
      kategoriLabel: string;
      moms_ore: number;
      deklarationsrutor?: { underlag: string; utgaende: string; ingaende: string };
    };
    flaggor: Flagga[];
    skill_versions: Record<string, string>;
  };
};

type Bokford = { status: string; verifikation?: { id: string; nummer: number; extern_ref: string } };

type Verifikation = {
  id: string;
  nummer: number;
  affarshandelsedatum: string;
  beskrivning: string;
  motpart: string;
  rattar_verifikation: string | null;
  extern_ref: string | null;
  rader: Rad[];
};

const kr = (ore: number) =>
  (ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.fel ?? `HTTP ${r.status}`);
  return data as T;
}

export default function Sida() {
  const [status, setStatus] = useState<Status | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [exempel, setExempel] = useState<Exempel[]>([]);
  const [tenant, setTenant] = useState("kund_a");

  const [text, setText] = useState("");
  const [tolkar, setTolkar] = useState(false);
  const [tolkning, setTolkning] = useState<Tolkning | null>(null);
  const [datum, setDatum] = useState("");
  const [forslag, setForslag] = useState<ForslagSvar | null>(null);
  const [konterar, setKonterar] = useState(false);
  const [beslutar, setBeslutar] = useState(false);
  const [bokford, setBokford] = useState<Bokford | null>(null);
  const [fel, setFel] = useState("");

  const [huvudbok, setHuvudbok] = useState<Verifikation[]>([]);
  const [dbfel, setDbfel] = useState("");

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then(setStatus);
    fetch("/api/tenants").then((r) => r.json()).then(setTenants);
    fetch("/api/exempel").then((r) => r.json()).then(setExempel);
  }, []);

  const laddaHuvudbok = useCallback(async (t: string) => {
    const r = await fetch(`/api/verifikationer?tenant=${t}`);
    setHuvudbok(await r.json());
  }, []);

  useEffect(() => {
    laddaHuvudbok(tenant);
    setDbfel("");
  }, [tenant, laddaHuvudbok]);

  function nollstall() {
    setTolkning(null);
    setForslag(null);
    setBokford(null);
    setFel("");
    setDatum("");
  }

  async function korTolkning() {
    nollstall();
    setTolkar(true);
    try {
      const t = await post<Tolkning>("/api/tolka", { tenant_id: tenant, text });
      setTolkning(t);
      setDatum(t.extraktion.datum);
      await korKontering(t, t.extraktion.datum);
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    } finally {
      setTolkar(false);
    }
  }

  async function korKontering(t: Tolkning, nyttDatum: string) {
    setKonterar(true);
    setBokford(null);
    setFel("");
    try {
      const f = await post<ForslagSvar>("/api/forslag", {
        tenant_id: tenant,
        document_id: t.document_id,
        extraktion: t.extraktion,
        engine: t.motor,
        engine_detalj: t.motor_detalj,
        affarshandelsedatum: nyttDatum,
      });
      setForslag(f);
      if (f.status === "auto_approved" && f.verifikation) {
        // Autonomipolicyn godkände — beslutet är policyns, loggat i beslutsmotorn.
        setBokford({ status: "bokford", verifikation: f.verifikation });
        await laddaHuvudbok(tenant);
      }
    } catch (e) {
      setForslag(null);
      setFel(e instanceof Error ? e.message : String(e));
    } finally {
      setKonterar(false);
    }
  }

  async function fattaBeslut(beslut: "godkand" | "avvisad") {
    if (!forslag) return;
    let reason: string | undefined;
    if (beslut === "avvisad") {
      // Beslutsmotorn kräver motivering vid avvisning — den blir del av
      // det append-only-beslutet.
      reason = window.prompt("Motivering för avvisningen (obligatorisk):") ?? undefined;
      if (!reason?.trim()) return;
    }
    setBeslutar(true);
    setFel("");
    try {
      const r = await post<Bokford>("/api/beslut", {
        tenant_id: tenant,
        proposal_id: forslag.proposal_id,
        beslut,
        godkand_av: "konsult@byran.se",
        reason,
      });
      setBokford(r);
      await laddaHuvudbok(tenant);
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    } finally {
      setBeslutar(false);
    }
  }

  async function rattelse(verId: string) {
    await post("/api/rattelse", { tenant_id: tenant, verification_id: verId });
    await laddaHuvudbok(tenant);
  }

  async function tamperDemo() {
    const r = await post<{ resultat: string; dbfel?: string }>("/api/demo/tamper", {
      tenant_id: tenant,
    });
    setDbfel(r.dbfel ?? r.resultat);
  }

  const motorBadge =
    tolkning?.motor ?? status?.motor ?? "fallback";

  return (
    <main>
      <div className="topbar">
        <div className="wordmark">
          grund<em>bok</em>
        </div>
        <div className="topbar-meta">
          <a href="/admin" className="badge" style={{ textDecoration: "none" }}>adminkonsol →</a>
          <span className={`badge ${motorBadge === "anthropic" ? "live" : "mock"}`}>
            <span className="dot" />
            {motorBadge === "anthropic" ? `live-AI · ${status?.modell}` : "mock-läge (deterministisk fallback)"}
          </span>
          <select value={tenant} onChange={(e) => { setTenant(e.target.value); nollstall(); }}>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.namn} ({t.mall})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Steg 1 — dokument in */}
      <section className="steg">
        <div className="steg-rubrik">
          <span className="steg-nr">1.</span>
          <span className="steg-titel">Kvitto eller faktura in</span>
          <span className="steg-not">untrusted input — injection-kontrolleras och ramas in som data</span>
        </div>
        <div className="knapprad">
          {exempel
            .filter((e) => e.tenant === tenant)
            .map((e) => (
              <button key={e.id} onClick={() => { setText(e.text); nollstall(); }}>
                {e.label}
              </button>
            ))}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Klistra in kvitto- eller fakturatext här …"
        />
        <div style={{ marginTop: "var(--sp-3)" }}>
          <button className="primar" onClick={korTolkning} disabled={tolkar || !text.trim()}>
            {tolkar ? "Tolkar …" : "Tolka dokumentet"}
          </button>
        </div>
      </section>

      {/* Steg 2 — tolkning */}
      <section className="steg" data-inaktiv={!tolkning}>
        <div className="steg-rubrik">
          <span className="steg-nr">2.</span>
          <span className="steg-titel">Tolkning</span>
          {tolkning && (
            <span className="steg-not">
              {tolkning.motor === "anthropic"
                ? `strukturerad output · ${tolkning.motor_detalj}`
                : `deterministisk fallback · ${tolkning.motor_detalj}`}
            </span>
          )}
        </div>
        {tolkning && (
          <>
            <dl className="falt-grid">
              <div className="falt"><dt>Motpart</dt><dd>{tolkning.extraktion.motpart}</dd></div>
              <div className="falt"><dt>Avser</dt><dd>{tolkning.extraktion.beskrivning}</dd></div>
              <div className="falt"><dt>Kategori</dt><dd>{tolkning.extraktion.kategori}</dd></div>
              <div className="falt"><dt>Netto</dt><dd className="tal">{kr(tolkning.extraktion.netto_ore)} kr</dd></div>
              <div className="falt">
                <dt>Moms enligt dokumentet</dt>
                <dd className="tal">
                  {tolkning.extraktion.moms_ore !== null ? `${kr(tolkning.extraktion.moms_ore)} kr` : "—"}
                  {tolkning.extraktion.momssats_angiven !== null && ` (${tolkning.extraktion.momssats_angiven} %)`}
                </dd>
              </div>
              <div className="falt"><dt>Betalsätt</dt><dd>{tolkning.extraktion.betalsatt}</dd></div>
            </dl>
            {tolkning.injektionsfynd.length > 0 && (
              <div className="flagga">
                Injection-kontrollen flaggade {tolkning.injektionsfynd.length} mönster i underlaget —
                innehållet behandlas som data, aldrig som instruktion.
              </div>
            )}
            <div style={{ display: "flex", gap: "var(--sp-3)", alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ fontSize: 13, color: "var(--fg-muted)" }}>
                Affärshändelsedatum{" "}
                <input
                  type="date"
                  value={datum}
                  onChange={(e) => {
                    setDatum(e.target.value);
                    if (tolkning && e.target.value) korKontering(tolkning, e.target.value);
                  }}
                />
              </label>
              {["2026-03-15", "2026-07-08"].map((d) => (
                <button
                  key={d}
                  disabled={datum === d}
                  onClick={() => {
                    setDatum(d);
                    if (tolkning) korKontering(tolkning, d);
                  }}
                >
                  {d === "2026-03-15" ? "15 mars 2026" : "8 juli 2026"}
                </button>
              ))}
              <span className="tyst">
                ← växla datum: momssatsen följer affärshändelsen, inte bokföringstillfället
              </span>
            </div>
          </>
        )}
      </section>

      {/* Steg 3 — förslag + gate */}
      <section className="steg" data-inaktiv={!forslag}>
        <div className="steg-rubrik">
          <span className="steg-nr">3.</span>
          <span className="steg-titel">Förslag — kräver konsultens godkännande</span>
          {konterar && <span className="steg-not laddar">konterar …</span>}
        </div>
        {forslag && (
          <>
            <dl className="falt-grid">
              <div className="falt">
                <dt>Momssats</dt>
                <dd>
                  <strong>{forslag.forslag.moms.sats} %</strong> · {forslag.forslag.moms.kategoriLabel}
                </dd>
              </div>
              <div className="falt"><dt>Lagrum</dt><dd>{forslag.forslag.moms.lagrum}</dd></div>
              {forslag.forslag.moms.deklarationsrutor && (
                <div className="falt">
                  <dt>Momsdeklaration</dt>
                  <dd>
                    ruta {forslag.forslag.moms.deklarationsrutor.underlag} /{" "}
                    {forslag.forslag.moms.deklarationsrutor.utgaende} /{" "}
                    {forslag.forslag.moms.deklarationsrutor.ingaende}
                  </dd>
                </div>
              )}
            </dl>

            <table className="rader">
              <thead>
                <tr><th>Konto</th><th>Benämning</th><th className="tal">Debet</th><th className="tal">Kredit</th></tr>
              </thead>
              <tbody>
                {forslag.forslag.rader.map((r, i) => (
                  <tr key={i}>
                    <td className="tal">{r.konto}</td>
                    <td>{r.kontonamn}</td>
                    <td className="tal">{r.debet_ore ? kr(r.debet_ore) : ""}</td>
                    <td className="tal">{r.kredit_ore ? kr(r.kredit_ore) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {forslag.forslag.flaggor.map((f) => (
              <div key={f.id} className={`flagga ${f.niva === "info" ? "info" : ""}`}>{f.text}</div>
            ))}

            <div className="metarad">
              {Object.entries(forslag.forslag.skill_versions).map(([skill, version]) => (
                <span key={skill} className="chip">{skill}@{version}</span>
              ))}
              <span className="chip">hash {forslag.hash.slice(0, 12)}…</span>
              <span className="chip">konfidens {forslag.confidence.toFixed(2)}</span>
              <span className="chip">{forslag.status === "auto_approved" ? "auto-godkänd av policy" : "i godkännandekön"}</span>
            </div>

            {forslag.status === "pending" && forslag.missade_villkor.length > 0 && (
              <p className="tyst" style={{ marginTop: "var(--sp-2)" }}>
                Utanför autonomipolicyn: {forslag.missade_villkor.join(" · ")}
              </p>
            )}

            {!bokford && forslag.status === "pending" && (
              <div style={{ display: "flex", gap: "var(--sp-3)", alignItems: "center", marginTop: "var(--sp-5)", flexWrap: "wrap" }}>
                <button className="godkann" onClick={() => fattaBeslut("godkand")} disabled={beslutar || konterar}>
                  {beslutar ? "Bokför …" : "Godkänn och bokför"}
                </button>
                <button onClick={() => fattaBeslut("avvisad")} disabled={beslutar || konterar}>
                  Avvisa
                </button>
                <span className="tyst" style={{ maxWidth: 380 }}>
                  Godkännandet binds till förslagets hash och konsultens identitet —
                  inget når ledgern utan detta beslut (ansvarsprincipen).
                </span>
              </div>
            )}
          </>
        )}
      </section>

      {/* Steg 4 — bokfört */}
      {bokford && (
        <section className="steg">
          <div className="steg-rubrik">
            <span className="steg-nr">4.</span>
            <span className="steg-titel">{bokford.status === "bokford" ? "Bokfört" : "Avvisat"}</span>
          </div>
          {bokford.status === "bokford" && bokford.verifikation ? (
            <div className="bokford">
              <div className="stor">Verifikation {bokford.verifikation.nummer}</div>
              <div className="tyst">
                Skriven append-only med tenant-scopat löpnummer · kvitterad av mock-Fortnox:{" "}
                {bokford.verifikation.extern_ref}
              </div>
            </div>
          ) : (
            <p className="tyst">Förslaget avvisades — beslutet är loggat, inget bokfördes.</p>
          )}
        </section>
      )}

      {fel && <p className="fel">{fel}</p>}

      {/* Huvudbok */}
      <h2 className="huvudbok-rubrik">Huvudbok — {tenants.find((t) => t.id === tenant)?.namn}</h2>
      <p className="huvudbok-not">
        Byt kund i växlaren uppe till höger: den andra kundens verifikationer försvinner —
        isoleringen är RLS-policyer i databasen, inte filter i applikationen.
      </p>
      <div className="knapprad">
        <button onClick={tamperDemo} disabled={huvudbok.length === 0}>
          Försök ändra en bokförd verifikation (demo)
        </button>
      </div>
      {dbfel && <div className="dberror">{dbfel}</div>}

      {huvudbok.length === 0 && <p className="tyst">Inga verifikationer ännu.</p>}
      {huvudbok.map((v) => (
        <div key={v.id} className="verifikation">
          <div className="huvud">
            <span className="nr">V{v.nummer}</span>
            <span className="beskr">{v.beskrivning}</span>
            <span className="tyst">{v.affarshandelsedatum.slice(0, 10)}</span>
            {v.rattar_verifikation && <span className="rattelse-tag">rättelsepost</span>}
            {v.extern_ref && <span className="chip">{v.extern_ref}</span>}
            <span className="hoger">
              {!v.rattar_verifikation && (
                <button onClick={() => rattelse(v.id)}>Skapa rättelsepost</button>
              )}
            </span>
          </div>
          <table className="rader">
            <tbody>
              {v.rader.map((r, i) => (
                <tr key={i}>
                  <td className="tal" style={{ width: 70 }}>{r.konto}</td>
                  <td>{r.kontonamn}</td>
                  <td className="tal">{Number(r.debet_ore) ? kr(Number(r.debet_ore)) : ""}</td>
                  <td className="tal">{Number(r.kredit_ore) ? kr(Number(r.kredit_ore)) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <footer>
        grundbok — vertikal skiva. Arkitekturen i{" "}
        <a href="https://github.com/leopold-jpg/grundbok/blob/main/ULTRAPLAN.md">ULTRAPLAN.md</a>,
        lånen i <a href="https://github.com/leopold-jpg/grundbok/blob/main/ATTRIBUTION.md">ATTRIBUTION.md</a>.
        Allt systemet producerar är förslag tills en behörig människa godkänt (BFL, ABL, Rex).
      </footer>
    </main>
  );
}
