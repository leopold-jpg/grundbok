"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EXEMPEL } from "@/lib/exempel";
import { plexMono } from "../_publik/fonter";
import "./byra.css";

// Byråns arbetsyta (WP13) — produkten. Inloggad konsult ser SIN byrås
// värld: attestkön (flyttad från v0-admin), manuellt intag (flyttat från
// gamla startsidan), chatten, beslutsloggen och klientvyn. Allt scopas
// genom sessionens byrå server-side; klientväljaren styr bara vyn.
// Attest-språk genomgående: "att attestera", "attesterad" — aldrig
// "proposals".

type Klient = { id: string; namn: string; mall: string };
type Sessionsvy = { byra: string; konsult: { id: string; namn: string }; klienter: Klient[] };

type Flagga = { id: string; niva: string; text: string };
type Lagrum = { lagrum: string; ruleset: string; note?: string };

type KoRad = {
  id: string;
  tenant_id: string;
  tenant_namn: string;
  module: string;
  kind: string;
  summary: string;
  motpart: string | null;
  belopp_ore: number;
  confidence: number;
  hash: string;
  created_at: string;
  flaggor: Flagga[];
  legal: Lagrum[];
  missade_villkor: string[];
};

type LoggRad = {
  proposal_id: string;
  tenant_id: string;
  tenant_namn: string;
  decided_at: string;
  outcome: "auto_approved" | "approved" | "rejected";
  beslutad_av: string;
  policy_beslut: boolean;
  verifikationsnummer: number | null;
  reason: string | null;
  summary: string;
  module: string;
  kind: string;
  model: string;
  agent_runtime: string | null;
};

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

type AgentRad = { id: string; display_name: string; module: string; status: string; created_at: string };

type Policy = {
  tenant_id: string;
  module: string;
  max_belopp_ore: number;
  min_confidence: number;
  kanda_motparter_endast: boolean;
  tillatna_kinds: string[];
};

type ChattInlagg = {
  roll: "konsult" | "agent";
  text: string;
  lagrum?: Lagrum[];
  konfidens?: number;
  saldo?: { konto: string; formaterat: string };
  motor?: string;
};

const kr = (ore: number) =>
  (ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const tid = (iso: string) =>
  new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });

// Bakgrundshämtningar (kö, logg, klientvy): en utgången session får inte
// lämna gammal data på skärmen — 401 skickar till inloggningen precis
// som post() gör (Bugbot PR #2). Övriga fel returnerar null (anroparen
// behåller/hanterar sitt tillstånd).
async function hamta<T>(url: string): Promise<T | null> {
  const r = await fetch(url);
  if (r.status === 401) {
    window.location.href = "/login?next=/byra";
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
    // Utloggad mitt i arbetet (t.ex. utgången session under en attest):
    // tillbaka till inloggningen i stället för ett fel i marginalen.
    window.location.href = "/login?next=/byra";
    throw new Error("sessionen har gått ut — du skickas till inloggningen");
  }
  const data = await r.json();
  if (!r.ok) {
    const fel = (data as { fel?: string | string[] }).fel;
    throw new Error(Array.isArray(fel) ? fel.join("; ") : (fel ?? `HTTP ${r.status}`));
  }
  return data as T;
}

const FLIKAR = [
  { id: "attest", namn: "Att attestera" },
  { id: "intag", namn: "Underlag in" },
  { id: "chatt", namn: "Chatt" },
  { id: "logg", namn: "Beslutslogg" },
  { id: "klient", namn: "Klient" },
] as const;
type FlikId = (typeof FLIKAR)[number]["id"];

// ---------------------------------------------------------------- attest

function AttestSektion({
  ko,
  visaKlient,
  onBeslutad,
}: {
  ko: KoRad[];
  visaKlient: boolean;
  onBeslutad: () => Promise<void>;
}) {
  const [fel, setFel] = useState("");
  const [bekraftelse, setBekraftelse] = useState("");
  const [beslutarId, setBeslutarId] = useState<string | null>(null);
  const [avvisarId, setAvvisarId] = useState<string | null>(null);
  const [motivering, setMotivering] = useState("");

  async function attestera(rad: KoRad, beslut: "godkand" | "avvisad", reason?: string) {
    setBeslutarId(rad.id);
    setFel("");
    setBekraftelse("");
    try {
      const r = await post<{
        status: string;
        verifikation?: { nummer: number; extern_ref: string } | null;
      }>("/api/beslut", {
        tenant_id: rad.tenant_id,
        proposal_id: rad.id,
        beslut,
        reason,
      });
      if (beslut === "godkand") {
        setBekraftelse(
          r.verifikation
            ? `Attesterad — bokförd som verifikation ${r.verifikation.nummer} (append-only, kvitterad: ${r.verifikation.extern_ref}).`
            : "Attesterad — utan ledger-effekt (rådgivningssvar bokförs inte).",
        );
      } else {
        setBekraftelse("Avvisad — beslutet och motiveringen är loggade, inget bokfördes.");
      }
      setAvvisarId(null);
      setMotivering("");
      await onBeslutad();
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    } finally {
      setBeslutarId(null);
    }
  }

  return (
    <section className="steg">
      <div className="steg-rubrik">
        <h2 className="steg-titel">Att attestera</h2>
        <span className="steg-not">
          {ko.length === 0 ? "inget väntar" : `${ko.length} väntar`} · avvikelsen mot er policy
          räknas om vid varje hämtning
        </span>
      </div>

      {bekraftelse && (
        <div className="bokford" style={{ marginBottom: "var(--sp-3)" }}>
          {bekraftelse}
        </div>
      )}

      {ko.length === 0 && (
        <p className="tyst">
          Inget att attestera just nu — nya underlag och frågor dyker upp här när de
          faller utanför er policy.
        </p>
      )}

      {ko.map((k) => (
        <div key={k.id} className="ko-kort">
          <div className="ko-huvud">
            <span className="ko-summary">{k.summary}</span>
            <span className="tyst tid">{tid(k.created_at)}</span>
          </div>

          <div className="metarad">
            {visaKlient && <span className="chip">{k.tenant_namn}</span>}
            <span className="chip">{k.module}</span>
            <span className="chip">konfidens {Math.round(k.confidence * 100)} %</span>
            <span className="chip tal">hash {k.hash.slice(0, 12)}…</span>
            {k.belopp_ore > 0 && <span className="chip tal">{kr(k.belopp_ore)} kr</span>}
            {k.motpart && <span className="chip">{k.motpart}</span>}
          </div>

          {k.legal.length > 0 && (
            <ul className="lagrum-lista">
              {k.legal.map((l, i) => (
                <li key={i}>
                  {l.lagrum} <span className="tyst">· {l.ruleset}</span>
                  {l.note ? ` — ${l.note}` : ""}
                </li>
              ))}
            </ul>
          )}

          {k.flaggor.map((f) => (
            <div key={f.id} className={`flagga ${f.niva === "info" ? "info" : ""}`}>
              {f.text}
            </div>
          ))}

          <div className="diff-rubrik">Varför den väntar på er</div>
          {k.missade_villkor.length === 0 ? (
            <p className="diff-ok">
              Uppfyller numera er policy — väntar ändå på ert beslut.
            </p>
          ) : (
            <ul className="diff-lista">
              {k.missade_villkor.map((v, i) => (
                <li key={i}>{v}</li>
              ))}
            </ul>
          )}

          {avvisarId === k.id ? (
            <div className="avvisa-rad">
              <input
                type="text"
                value={motivering}
                onChange={(e) => setMotivering(e.target.value)}
                placeholder="Motivering (krävs för avvisning)"
                autoFocus
              />
              <button
                onClick={() => attestera(k, "avvisad", motivering)}
                disabled={!motivering.trim() || beslutarId !== null}
              >
                {beslutarId === k.id ? "Avvisar …" : "Skicka avvisning"}
              </button>
              <button
                onClick={() => {
                  setAvvisarId(null);
                  setMotivering("");
                }}
                disabled={beslutarId !== null}
              >
                Avbryt
              </button>
            </div>
          ) : (
            <div className="beslutsrad">
              <button
                className="godkann"
                onClick={() => attestera(k, "godkand")}
                disabled={beslutarId !== null}
              >
                {beslutarId === k.id ? "Bokför …" : "Attestera"}
              </button>
              <button
                onClick={() => {
                  setAvvisarId(k.id);
                  setMotivering("");
                }}
                disabled={beslutarId !== null}
              >
                Avvisa
              </button>
              <span className="tyst" style={{ maxWidth: 380 }}>
                Attesten binds till förslagets hash och din identitet — inget når
                huvudboken utan den (ansvarsprincipen).
              </span>
            </div>
          )}
        </div>
      ))}

      {fel && <p className="fel">{fel}</p>}
    </section>
  );
}

// ----------------------------------------------------------------- intag

function IntagSektion({
  klient,
  onNyttForslag,
}: {
  klient: Klient | null;
  onNyttForslag: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [tolkar, setTolkar] = useState(false);
  const [tolkning, setTolkning] = useState<Tolkning | null>(null);
  const [datum, setDatum] = useState("");
  const [forslag, setForslag] = useState<ForslagSvar | null>(null);
  const [konterar, setKonterar] = useState(false);
  const [beslutar, setBeslutar] = useState(false);
  const [avvisar, setAvvisar] = useState(false);
  const [motivering, setMotivering] = useState("");
  const [utfall, setUtfall] = useState("");
  const [fel, setFel] = useState("");

  function nollstall() {
    setTolkning(null);
    setForslag(null);
    setAvvisar(false);
    setMotivering("");
    setUtfall("");
    setFel("");
    setDatum("");
  }

  // Byte av klient nollställer flödet — underlaget hör till en klient.
  useEffect(() => {
    nollstall();
    setText("");
  }, [klient?.id]);

  if (!klient) {
    return (
      <section className="steg">
        <div className="steg-rubrik">
          <h2 className="steg-titel">Underlag in</h2>
        </div>
        <p className="tyst">Välj en klient i väljaren uppe till höger för att ta in underlag.</p>
      </section>
    );
  }

  async function korTolkning() {
    nollstall();
    setTolkar(true);
    try {
      const t = await post<Tolkning>("/api/byra/intag/tolka", {
        tenant_id: klient!.id,
        text,
      });
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
    setUtfall("");
    setFel("");
    try {
      const f = await post<ForslagSvar>("/api/byra/intag/forslag", {
        tenant_id: klient!.id,
        document_id: t.document_id,
        extraktion: t.extraktion,
        engine: t.motor,
        engine_detalj: t.motor_detalj,
        affarshandelsedatum: nyttDatum,
      });
      setForslag(f);
      if (f.status === "auto_approved" && f.verifikation) {
        setUtfall(
          `Inom er policy — bokförd direkt som verifikation ${f.verifikation.nummer}, loggad som policybeslut.`,
        );
      }
      await onNyttForslag();
    } catch (e) {
      setForslag(null);
      setFel(e instanceof Error ? e.message : String(e));
    } finally {
      setKonterar(false);
    }
  }

  // Avvisning motiveras i det tillgängliga inline-mönstret (samma som
  // attestkön) — inte window.prompt (ostylat, skärmläsarfientligt).
  async function attesteraDirekt(beslut: "godkand" | "avvisad", reason?: string) {
    if (!forslag) return;
    setBeslutar(true);
    setFel("");
    try {
      const r = await post<{
        status: string;
        verifikation?: { nummer: number; extern_ref: string } | null;
      }>("/api/beslut", {
        tenant_id: klient!.id,
        proposal_id: forslag.proposal_id,
        beslut,
        reason,
      });
      setUtfall(
        beslut === "godkand"
          ? `Attesterad — bokförd som verifikation ${r.verifikation?.nummer} (kvitterad: ${r.verifikation?.extern_ref}).`
          : "Avvisad — beslutet och motiveringen är loggade, inget bokfördes.",
      );
      setAvvisar(false);
      setMotivering("");
      await onNyttForslag();
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    } finally {
      setBeslutar(false);
    }
  }

  const exempel = EXEMPEL.filter((e) => e.tenant === klient.id);

  return (
    <>
      <section className="steg">
        <div className="steg-rubrik">
          <span className="steg-nr">1.</span>
          <h2 className="steg-titel">Underlag in — {klient.namn}</h2>
          <span className="steg-not">
            underlaget behandlas som data, aldrig som instruktion
            {/* TODO S3: mejladress per klient och kundappens foto landar i samma flöde. */}
          </span>
        </div>
        {exempel.length > 0 && (
          <div className="knapprad">
            {exempel.map((e) => (
              <button
                key={e.id}
                onClick={() => {
                  setText(e.text);
                  nollstall();
                }}
              >
                {e.label}
              </button>
            ))}
          </div>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Klistra in kvitto- eller fakturatext här …"
        />
        <div style={{ marginTop: "var(--sp-3)" }}>
          <button className="primar" onClick={korTolkning} disabled={tolkar || !text.trim()}>
            {tolkar ? "Tolkar …" : "Tolka underlaget"}
          </button>
        </div>
      </section>

      <section className="steg" data-inaktiv={!tolkning}>
        <div className="steg-rubrik">
          <span className="steg-nr">2.</span>
          <h2 className="steg-titel">Tolkning</h2>
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
                <dt>Moms enligt underlaget</dt>
                <dd className="tal">
                  {tolkning.extraktion.moms_ore !== null ? `${kr(tolkning.extraktion.moms_ore)} kr` : "—"}
                  {tolkning.extraktion.momssats_angiven !== null &&
                    ` (${tolkning.extraktion.momssats_angiven} %)`}
                </dd>
              </div>
              <div className="falt"><dt>Betalsätt</dt><dd>{tolkning.extraktion.betalsatt}</dd></div>
            </dl>
            {tolkning.injektionsfynd.length > 0 && (
              <div className="flagga">
                Injection-kontrollen flaggade {tolkning.injektionsfynd.length} mönster i
                underlaget — innehållet behandlas som data, aldrig som instruktion.
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
              <span className="tyst">exempeldatum:</span>
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

      <section className="steg" data-inaktiv={!forslag}>
        <div className="steg-rubrik">
          <span className="steg-nr">3.</span>
          <h2 className="steg-titel">Förslag</h2>
          {konterar && <span className="steg-not laddar">konterar …</span>}
          {forslag && !konterar && (
            <span className="steg-not">
              {forslag.status === "auto_approved"
                ? "inom er policy — bokförd som policybeslut"
                : "ligger i attestkön tills ni beslutar"}
            </span>
          )}
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
                <tr>
                  <th>Konto</th>
                  <th>Benämning</th>
                  <th className="tal">Debet</th>
                  <th className="tal">Kredit</th>
                </tr>
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
              <div key={f.id} className={`flagga ${f.niva === "info" ? "info" : ""}`}>
                {f.text}
              </div>
            ))}

            <div className="metarad">
              {Object.entries(forslag.forslag.skill_versions).map(([skill, version]) => (
                <span key={skill} className="chip">
                  {skill}@{version}
                </span>
              ))}
              <span className="chip tal">hash {forslag.hash.slice(0, 12)}…</span>
              <span className="chip">konfidens {Math.round(forslag.confidence * 100)} %</span>
            </div>

            {forslag.status === "pending" && forslag.missade_villkor.length > 0 && (
              <p className="tyst" style={{ marginTop: "var(--sp-2)" }}>
                Utanför er policy: {forslag.missade_villkor.join(" · ")}
              </p>
            )}

            {utfall && (
              <div className="bokford" style={{ marginTop: "var(--sp-4)" }}>
                {utfall}
              </div>
            )}

            {!utfall && forslag.status === "pending" && avvisar && (
              <div className="avvisa-rad">
                <input
                  type="text"
                  value={motivering}
                  onChange={(e) => setMotivering(e.target.value)}
                  placeholder="Motivering (krävs för avvisning)"
                  autoFocus
                />
                <button
                  onClick={() => attesteraDirekt("avvisad", motivering)}
                  disabled={!motivering.trim() || beslutar || konterar}
                >
                  {beslutar ? "Avvisar …" : "Skicka avvisning"}
                </button>
                <button
                  onClick={() => {
                    setAvvisar(false);
                    setMotivering("");
                  }}
                  disabled={beslutar}
                >
                  Avbryt
                </button>
              </div>
            )}

            {!utfall && forslag.status === "pending" && !avvisar && (
              <div className="beslutsrad">
                <button
                  className="godkann"
                  onClick={() => attesteraDirekt("godkand")}
                  disabled={beslutar || konterar}
                >
                  {beslutar ? "Bokför …" : "Attestera och bokför"}
                </button>
                <button
                  onClick={() => {
                    setAvvisar(true);
                    setMotivering("");
                  }}
                  disabled={beslutar || konterar}
                >
                  Avvisa
                </button>
                <span className="tyst" style={{ maxWidth: 380 }}>
                  Attesten binds till förslagets hash och din identitet — inget når
                  huvudboken utan den.
                </span>
              </div>
            )}
          </>
        )}
      </section>

      {fel && <p className="fel">{fel}</p>}
    </>
  );
}

// ----------------------------------------------------------------- chatt

function ChattSektion({ klient, userId }: { klient: Klient | null; userId: string }) {
  const [historik, setHistorik] = useState<ChattInlagg[]>([]);
  const [fraga, setFraga] = useState("");
  const [svarar, setSvarar] = useState(false);
  const [fel, setFel] = useState("");

  // Historik per konsult och klient — sessionStorage räcker (ingen delad
  // tråd i v1; frågan+svaret är redan spårade som advisory_answer-förslag).
  const lagringsnyckel = klient ? `grundbok_chatt_${userId}_${klient.id}` : null;

  useEffect(() => {
    if (!lagringsnyckel) return;
    try {
      const sparad = sessionStorage.getItem(lagringsnyckel);
      setHistorik(sparad ? (JSON.parse(sparad) as ChattInlagg[]) : []);
    } catch {
      setHistorik([]);
    }
  }, [lagringsnyckel]);

  function spara(nya: ChattInlagg[]) {
    setHistorik(nya);
    if (lagringsnyckel) sessionStorage.setItem(lagringsnyckel, JSON.stringify(nya));
  }

  if (!klient) {
    return (
      <section className="steg">
        <div className="steg-rubrik">
          <h2 className="steg-titel">Chatt</h2>
        </div>
        <p className="tyst">
          Välj en klient — saldofrågor besvaras ur den valda klientens huvudbok.
        </p>
      </section>
    );
  }

  async function stall() {
    const q = fraga.trim();
    if (!q) return;
    const medFraga: ChattInlagg[] = [...historik, { roll: "konsult", text: q }];
    spara(medFraga);
    setFraga("");
    setSvarar(true);
    setFel("");
    try {
      const r = await post<{
        svar: string;
        lagrum: Lagrum[];
        konfidens: number;
        saldo?: { konto: string; formaterat: string };
        motor: string;
      }>("/api/byra/chatt", { tenant_id: klient!.id, fraga: q });
      spara([
        ...medFraga,
        {
          roll: "agent",
          text: r.svar,
          lagrum: r.lagrum,
          konfidens: r.konfidens,
          saldo: r.saldo,
          motor: r.motor,
        },
      ]);
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    } finally {
      setSvarar(false);
    }
  }

  return (
    <section className="steg">
      <div className="steg-rubrik">
        <h2 className="steg-titel">Chatt — {klient.namn}</h2>
        <span className="steg-not">
          konton, moms, lagrum och saldon · varje svar loggas med lagrum och konfidens
        </span>
      </div>

      <div className="chatt-historik">
        {historik.length === 0 && (
          <p className="tyst">
            Ställ en fråga — t.ex. &quot;Vilken momssats gäller för livsmedel?&quot; eller
            &quot;Vad är saldot på 1930?&quot;
          </p>
        )}
        {historik.map((m, i) => (
          <div key={i} className={`bubbla ${m.roll}`}>
            {m.text}
            {m.roll === "agent" && (
              <div className="bubbla-meta">
                {m.saldo && (
                  <span className="chip tal">
                    saldo {m.saldo.konto}: {m.saldo.formaterat}
                  </span>
                )}
                {m.lagrum?.map((l, j) => (
                  <span key={j} className="chip">
                    {l.lagrum}
                  </span>
                ))}
                {m.konfidens !== undefined && (
                  <span className="chip">konfidens {Math.round(m.konfidens * 100)} %</span>
                )}
                {m.motor === "fallback" && <span className="chip">deterministisk fallback</span>}
              </div>
            )}
          </div>
        ))}
        {svarar && <p className="laddar">svarar …</p>}
      </div>

      <div className="chatt-rad">
        <input
          type="text"
          value={fraga}
          onChange={(e) => setFraga(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !svarar) stall();
          }}
          placeholder="Fråga om konton, moms, lagrum eller saldon …"
        />
        <button className="primar" onClick={stall} disabled={svarar || !fraga.trim()}>
          Fråga
        </button>
      </div>
      {fel && <p className="fel">{fel}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ logg

function LoggSektion({ logg, visaKlient }: { logg: LoggRad[]; visaKlient: boolean }) {
  return (
    <section className="steg">
      <div className="steg-rubrik">
        <h2 className="steg-titel">Beslutslogg</h2>
        <span className="steg-not">append-only — senaste 50, nyast först</span>
      </div>

      {logg.length === 0 ? (
        <p className="tyst">Inga beslut ännu.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="rader">
            <thead>
              <tr>
                <th>Tid</th>
                {visaKlient && <th>Klient</th>}
                <th>Underlag</th>
                <th>Beslut</th>
                <th className="tal">Ver.nr</th>
                <th>Modell</th>
              </tr>
            </thead>
            <tbody>
              {logg.map((l) => (
                <tr key={`${l.proposal_id}-${l.decided_at}`}>
                  <td className="tal">{tid(l.decided_at)}</td>
                  {visaKlient && <td>{l.tenant_namn}</td>}
                  <td>{l.summary}</td>
                  <td>
                    {l.policy_beslut ? (
                      <>
                        <span className="chip">policybeslut</span>{" "}
                        <span className="tyst">inom er policy</span>
                      </>
                    ) : l.outcome === "approved" ? (
                      <>
                        attesterad <span className="tyst">· {l.beslutad_av}</span>
                      </>
                    ) : (
                      <>
                        avvisad{" "}
                        <span className="tyst">
                          · {l.beslutad_av}
                          {l.reason ? ` — ${l.reason}` : ""}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="tal">{l.verifikationsnummer ?? "—"}</td>
                  <td>
                    {l.model}
                    {l.agent_runtime && <span className="chip">{l.agent_runtime}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- klient

function KlientSektion({
  klient,
  onForandring,
}: {
  klient: Klient | null;
  onForandring: () => Promise<void>;
}) {
  const [verifikationer, setVerifikationer] = useState<Verifikation[]>([]);
  const [agenter, setAgenter] = useState<AgentRad[]>([]);
  const [policyer, setPolicyer] = useState<Policy[]>([]);
  const [fel, setFel] = useState("");
  const [sparat, setSparat] = useState<Record<string, string>>({});

  // Formulärstate i kronor/strängar så inmatning inte låser.
  const [former, setFormer] = useState<
    Record<string, { auto: boolean; belopp_kr: string; konfidens: string; kanda: boolean }>
  >({});

  const ladda = useCallback(async () => {
    if (!klient) return;
    setFel("");
    try {
      const [v, a, p] = await Promise.all([
        hamta<Verifikation[]>(`/api/byra/klient/verifikationer?klient=${klient.id}`),
        hamta<AgentRad[]>(`/api/byra/klient/agenter?klient=${klient.id}`),
        hamta<Policy[]>(`/api/byra/klient/policy?klient=${klient.id}`),
      ]);
      setVerifikationer(Array.isArray(v) ? v : []);
      setAgenter(Array.isArray(a) ? a : []);
      const pol = Array.isArray(p) ? p : [];
      setPolicyer(pol);
      const nya: typeof former = {};
      for (const modul of ["bokforing", "radgivning"]) {
        const rad = pol.find((x) => x.module === modul);
        const kind = modul === "bokforing" ? "journal_entry" : "advisory_answer";
        nya[modul] = {
          auto: rad ? rad.tillatna_kinds.includes(kind) : false,
          belopp_kr: rad ? String(rad.max_belopp_ore / 100) : "0",
          konfidens: rad ? String(rad.min_confidence) : "1",
          kanda: rad ? rad.kanda_motparter_endast : true,
        };
      }
      setFormer(nya);
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    }
  }, [klient]);

  useEffect(() => {
    setSparat({});
    ladda();
  }, [ladda]);

  if (!klient) {
    return (
      <section className="steg">
        <div className="steg-rubrik">
          <h2 className="steg-titel">Klient</h2>
        </div>
        <p className="tyst">Välj en klient i väljaren uppe till höger.</p>
      </section>
    );
  }

  async function rattelse(verId: string) {
    setFel("");
    try {
      await post("/api/rattelse", { tenant_id: klient!.id, verification_id: verId });
      await ladda();
      await onForandring();
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    }
  }

  async function sparaPolicyForm(modul: string) {
    const f = former[modul];
    const befintlig = policyer.find((p) => p.module === modul);
    if (!f) return;
    setFel("");
    setSparat((s) => ({ ...s, [modul]: "" }));

    const beloppKr = Number(f.belopp_kr.replace(/\s/g, "").replace(",", "."));
    const minConf = Number(f.konfidens.replace(",", "."));
    if (!Number.isFinite(beloppKr) || beloppKr < 0) {
      setFel(`${modul}: beloppet måste vara ett icke-negativt tal i kronor`);
      return;
    }
    if (!Number.isFinite(minConf) || minConf < 0 || minConf > 1) {
      setFel(`${modul}: konfidensen måste ligga mellan 0 och 1`);
      return;
    }

    // Attest-språket mappar rakt på kärnans fält: bocken styr om modulens
    // rutin-kind får auto-godkännas; correction auto-godkänns aldrig
    // (hård regel i motorn oavsett vad som sparas här).
    const kind = modul === "bokforing" ? "journal_entry" : "advisory_answer";
    const ovriga = (befintlig?.tillatna_kinds ?? []).filter((k) => k !== kind);
    const tillatna = f.auto ? [...ovriga, kind] : ovriga;

    try {
      await post("/api/byra/klient/policy", {
        tenant_id: klient!.id,
        module: modul,
        max_belopp_ore: Math.round(beloppKr * 100),
        min_confidence: minConf,
        kanda_motparter_endast: f.kanda,
        tillatna_kinds: tillatna,
      });
      setSparat((s) => ({ ...s, [modul]: "sparad — attestkön räknas om mot nya policyn" }));
      await ladda();
      await onForandring();
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    }
  }

  function uppdatera(modul: string, patch: Partial<(typeof former)[string]>) {
    setFormer((s) => ({ ...s, [modul]: { ...s[modul], ...patch } }));
    setSparat((s) => ({ ...s, [modul]: "" }));
  }

  return (
    <>
      {/* Policy — trösklar i attest-språk */}
      <section className="steg">
        <div className="steg-rubrik">
          <h2 className="steg-titel">Policy — {klient.namn}</h2>
          <span className="steg-not">
            allt utanför gränserna hamnar i attestkön · rättelser kräver alltid människa
          </span>
        </div>
        {(["bokforing", "radgivning"] as const).map((modul) => {
          const f = former[modul];
          if (!f) return null;
          return (
            <div key={modul} className="policy-enkel">
              <h3 className="policy-namn">{modul === "bokforing" ? "Bokföring" : "Rådgivning"}</h3>
              <div className="policy-rad">
                <span className="check-val">
                  <input
                    id={`${modul}-auto`}
                    type="checkbox"
                    checked={f.auto}
                    onChange={(e) => uppdatera(modul, { auto: e.target.checked })}
                  />
                  <label htmlFor={`${modul}-auto`}>
                    {modul === "bokforing"
                      ? "Bokför själv upp till"
                      : "Svara själv på frågor upp till"}
                  </label>
                </span>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={f.belopp_kr}
                  onChange={(e) => uppdatera(modul, { belopp_kr: e.target.value })}
                  aria-label={`${modul}: max belopp i kronor`}
                />
                kr
                <span className="check-val">
                  <input
                    id={`${modul}-kanda`}
                    type="checkbox"
                    checked={f.kanda}
                    onChange={(e) => uppdatera(modul, { kanda: e.target.checked })}
                  />
                  <label htmlFor={`${modul}-kanda`}>
                    endast kända motparter
                  </label>
                </span>
                <span className="check-val">
                  minst
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={f.konfidens}
                    onChange={(e) => uppdatera(modul, { konfidens: e.target.value })}
                    aria-label={`${modul}: min konfidens (0–1)`}
                  />
                  i konfidens
                </span>
              </div>
              <div className="beslutsrad" style={{ marginTop: "var(--sp-3)" }}>
                <button className="primar" onClick={() => sparaPolicyForm(modul)}>
                  Spara
                </button>
                {sparat[modul] && <span className="sparat">{sparat[modul]}</span>}
              </div>
            </div>
          );
        })}
      </section>

      {/* Agenter — läsvy */}
      <section className="steg">
        <div className="steg-rubrik">
          <h2 className="steg-titel">Agenter</h2>
          <span className="steg-not">
            läsvy — provisionering och drift sköts av operatören, aldrig här
          </span>
        </div>
        {agenter.length === 0 ? (
          <p className="tyst">Inga agenter är igång för {klient.namn}.</p>
        ) : (
          <table className="rader">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Modul</th>
                <th>Status</th>
                <th>Igång sedan</th>
              </tr>
            </thead>
            <tbody>
              {agenter.map((a) => (
                <tr key={a.id}>
                  <td>{a.display_name}</td>
                  <td>{a.module}</td>
                  <td>
                    {a.status === "active" && "aktiv"}
                    {a.status === "paused" && <span className="tyst">pausad</span>}
                    {a.status === "canceled" && <span className="tyst">avslutad</span>}
                  </td>
                  <td className="tal">{tid(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Huvudbok */}
      <section className="steg">
        <div className="steg-rubrik">
          <h2 className="steg-titel">Verifikationer — {klient.namn}</h2>
          <span className="steg-not">
            append-only — fel rättas med rättelsepost, aldrig genom ändring (BFL 5:5)
          </span>
        </div>
        {verifikationer.length === 0 && (
          <p className="tyst">
            Inga verifikationer ännu för {klient.namn} — ta in det första underlaget
            under fliken Underlag in, eller vänta in att något attesteras.
          </p>
        )}
        {verifikationer.map((v) => (
          <div key={v.id} className="verifikation">
            <div className="huvud">
              <span className="nr">V{v.nummer}</span>
              <span className="beskr">{v.beskrivning}</span>
              <span className="tyst">{v.affarshandelsedatum.slice(0, 10)}</span>
              {v.rattar_verifikation && <span className="rattelse-tag">rättelsepost</span>}
              {v.extern_ref && <span className="chip tal">{v.extern_ref}</span>}
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
      </section>

      {fel && <p className="fel">{fel}</p>}
    </>
  );
}

// ------------------------------------------------------------------ sida

export default function ByraSida() {
  const router = useRouter();
  const [session, setSession] = useState<Sessionsvy | null>(null);
  const [val, setVal] = useState<string>("alla"); // "alla" | tenant-id
  const [flik, setFlik] = useState<FlikId>("attest");
  const [ko, setKo] = useState<KoRad[]>([]);
  const [logg, setLogg] = useState<LoggRad[]>([]);

  useEffect(() => {
    fetch("/api/byra/klienter").then(async (r) => {
      if (!r.ok) {
        router.push("/login?next=/byra");
        return;
      }
      setSession((await r.json()) as Sessionsvy);
    });
  }, [router]);

  const laddaKo = useCallback(async (v: string) => {
    const rader = await hamta<KoRad[]>(`/api/byra/ko?klient=${v}`);
    if (rader) setKo(rader);
  }, []);

  const laddaLogg = useCallback(async (v: string) => {
    const rader = await hamta<LoggRad[]>(`/api/byra/logg?klient=${v}&limit=50`);
    if (rader) setLogg(rader);
  }, []);

  useEffect(() => {
    if (!session) return;
    laddaKo(val);
    laddaLogg(val);
  }, [session, val, laddaKo, laddaLogg]);

  const uppdatera = useCallback(async () => {
    await Promise.all([laddaKo(val), laddaLogg(val)]);
  }, [val, laddaKo, laddaLogg]);

  async function loggaUt() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  if (!session) {
    return (
      <main className={`byra ${plexMono.variable}`}>
        <p className="laddar">laddar …</p>
      </main>
    );
  }

  const valdKlient = session.klienter.find((k) => k.id === val) ?? null;

  return (
    <main className={`byra ${plexMono.variable}`}>
      <h1 className="sr-rubrik">Byråns arbetsyta — {session.byra}</h1>
      <div className="topbar">
        <div className="wordmark-rad">
          <div className="wordmark">
            grund<em>bok</em>
          </div>
          <span className="undertitel">{session.byra}</span>
        </div>
        <div className="topbar-meta">
          <span className="tyst">{session.konsult.namn}</span>
          <button onClick={loggaUt}>Logga ut</button>
          <select value={val} onChange={(e) => setVal(e.target.value)}>
            <option value="alla">alla klienter</option>
            {session.klienter.map((k) => (
              <option key={k.id} value={k.id}>
                {k.namn} ({k.mall})
              </option>
            ))}
          </select>
        </div>
      </div>

      <nav className="flikar">
        {FLIKAR.map((f) => (
          <button
            key={f.id}
            className="flik"
            data-aktiv={flik === f.id}
            onClick={() => setFlik(f.id)}
          >
            {f.namn}
            {f.id === "attest" && ko.length > 0 && <span className="antal">{ko.length}</span>}
          </button>
        ))}
      </nav>

      {flik === "attest" && (
        <AttestSektion ko={ko} visaKlient={val === "alla"} onBeslutad={uppdatera} />
      )}
      {flik === "intag" && <IntagSektion klient={valdKlient} onNyttForslag={uppdatera} />}
      {flik === "chatt" && <ChattSektion klient={valdKlient} userId={session.konsult.id} />}
      {flik === "logg" && <LoggSektion logg={logg} visaKlient={val === "alla"} />}
      {flik === "klient" && <KlientSektion klient={valdKlient} onForandring={uppdatera} />}

      <footer>
        Attest bor hos byrån, drift hos operatören. Varje attest binds till förslagets
        hash och din inloggade identitet — grunden för ansvarsfördelningen (ADR-0002).
      </footer>
    </main>
  );
}
