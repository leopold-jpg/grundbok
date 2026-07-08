"use client";

import { useCallback, useEffect, useState } from "react";
import { PROPOSAL_KINDS } from "@/contracts/schema";
import "./admin.css";

// Adminkonsolen (WP6): godkännandekö, autonomipolicy-editor och beslutslogg.
// Konsolen läser via /api/admin/* och fattar beslut via decideProposal —
// samma hash-bundna väg som allt annat; det finns ingen sidodörr.

type Tenant = { id: string; namn: string; mall: string };
type Flagga = { id: string; niva: string; text: string };
type Lagrum = { lagrum: string; ruleset: string; note?: string };

type KoRad = {
  id: string;
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
  decided_at: string;
  outcome: "auto_approved" | "approved" | "rejected";
  decided_by: string;
  verifikationsnummer: number | null;
  reason: string | null;
  summary: string;
  module: string;
  kind: string;
  confidence: number;
  model: string;
  agent_runtime: string | null;
};

type Policy = {
  tenant_id: string;
  module: string;
  max_belopp_ore: number;
  min_confidence: number;
  kanda_motparter_endast: boolean;
  tillatna_kinds: string[];
};

type NyckelRad = {
  id: string;
  module: string;
  namn: string;
  scopes: string[];
  active: boolean;
  created_at: string;
};

const NYCKEL_SCOPES = ["proposals:write", "ledger:read", "documents:read"] as const;

/** Formulärstate: kronor och konfidens som strängar så inmatning inte låser. */
type PolicyForm = {
  max_belopp_kr: string;
  min_confidence: string;
  kanda_motparter_endast: boolean;
  tillatna_kinds: string[];
};

// Modulerna som har policy-editor i v0 (fler landar med resp. modul).
const POLICY_MODULER = ["bokforing", "radgivning"] as const;

const kr = (ore: number) =>
  (ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const tid = (iso: string) =>
  new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) {
    const fel = (data as { fel?: string | string[] }).fel;
    throw new Error(Array.isArray(fel) ? fel.join("; ") : (fel ?? `HTTP ${r.status}`));
  }
  return data as T;
}

function tillForm(p: Policy | undefined): PolicyForm {
  // Saknas raden speglas motorns default: utan policy auto-godkänns inget.
  return {
    max_belopp_kr: p ? String(p.max_belopp_ore / 100) : "0",
    min_confidence: p ? String(p.min_confidence) : "1",
    kanda_motparter_endast: p ? p.kanda_motparter_endast : true,
    tillatna_kinds: p ? p.tillatna_kinds : [],
  };
}

export default function AdminSida() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenant, setTenant] = useState("kund_a");

  const [ko, setKo] = useState<KoRad[]>([]);
  const [logg, setLogg] = useState<LoggRad[]>([]);
  const [former, setFormer] = useState<Record<string, PolicyForm>>({});

  const [fel, setFel] = useState("");
  const [bekraftelse, setBekraftelse] = useState("");
  const [beslutarId, setBeslutarId] = useState<string | null>(null);
  const [avvisarId, setAvvisarId] = useState<string | null>(null);
  const [motivering, setMotivering] = useState("");
  const [policySparat, setPolicySparat] = useState<Record<string, string>>({});

  const laddaKo = useCallback(async (t: string) => {
    const r = await fetch(`/api/admin/ko?tenant=${t}`);
    setKo(await r.json());
  }, []);

  const laddaLogg = useCallback(async (t: string) => {
    const r = await fetch(`/api/admin/logg?tenant=${t}&limit=50`);
    setLogg(await r.json());
  }, []);

  const laddaPolicyer = useCallback(async (t: string) => {
    const r = await fetch(`/api/admin/policy?tenant=${t}`);
    const policyer = (await r.json()) as Policy[];
    const nya: Record<string, PolicyForm> = {};
    for (const m of POLICY_MODULER) nya[m] = tillForm(policyer.find((p) => p.module === m));
    setFormer(nya);
  }, []);

  useEffect(() => {
    fetch("/api/tenants").then((r) => r.json()).then(setTenants);
  }, []);

  useEffect(() => {
    setFel("");
    setBekraftelse("");
    setAvvisarId(null);
    setMotivering("");
    setPolicySparat({});
    laddaKo(tenant);
    laddaLogg(tenant);
    laddaPolicyer(tenant);
  }, [tenant, laddaKo, laddaLogg, laddaPolicyer]);

  async function besluta(rad: KoRad, outcome: "approved" | "rejected", reason?: string) {
    setBeslutarId(rad.id);
    setFel("");
    setBekraftelse("");
    try {
      const r = await post<{
        outcome: string;
        verifikation?: { id: string; nummer: number; extern_ref: string } | null;
      }>("/api/admin/beslut", {
        tenant_id: tenant,
        proposal_id: rad.id,
        outcome,
        decided_by: "konsult@byran.se",
        reason,
      });
      if (outcome === "approved") {
        setBekraftelse(
          r.verifikation
            ? `Godkänt — bokfört som verifikation ${r.verifikation.nummer} (append-only, kvitterad: ${r.verifikation.extern_ref}).`
            : "Godkänt — utan ledger-effekt (rådgivningssvar bokförs inte).",
        );
      } else {
        setBekraftelse("Avvisat — beslutet och motiveringen är loggade, inget bokfördes.");
      }
      setAvvisarId(null);
      setMotivering("");
      await Promise.all([laddaKo(tenant), laddaLogg(tenant)]);
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    } finally {
      setBeslutarId(null);
    }
  }

  async function sparaPolicyForm(modul: string) {
    const f = former[modul];
    if (!f) return;
    setFel("");
    setPolicySparat((s) => ({ ...s, [modul]: "" }));

    const beloppKr = Number(f.max_belopp_kr.replace(/\s/g, "").replace(",", "."));
    const minConf = Number(f.min_confidence.replace(",", "."));
    if (!Number.isFinite(beloppKr) || beloppKr < 0) {
      setFel(`${modul}: max belopp måste vara ett icke-negativt tal i kronor`);
      return;
    }
    if (!Number.isFinite(minConf) || minConf < 0 || minConf > 1) {
      setFel(`${modul}: min konfidens måste ligga mellan 0 och 1`);
      return;
    }

    try {
      await post("/api/admin/policy", {
        tenant_id: tenant,
        module: modul,
        max_belopp_ore: Math.round(beloppKr * 100), // UI i kronor → motorn i ören
        min_confidence: minConf,
        kanda_motparter_endast: f.kanda_motparter_endast,
        tillatna_kinds: f.tillatna_kinds,
      });
      setPolicySparat((s) => ({ ...s, [modul]: "sparad — kön räknas om mot nya policyn" }));
      // Diffen i kön avser GÄLLANDE policy — ladda om den direkt.
      await Promise.all([laddaKo(tenant), laddaPolicyer(tenant)]);
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    }
  }

  function uppdateraForm(modul: string, patch: Partial<PolicyForm>) {
    setFormer((s) => ({ ...s, [modul]: { ...s[modul], ...patch } }));
    setPolicySparat((s) => ({ ...s, [modul]: "" }));
  }

  function vaxlaKind(modul: string, kind: string) {
    const f = former[modul];
    if (!f) return;
    uppdateraForm(modul, {
      tillatna_kinds: f.tillatna_kinds.includes(kind)
        ? f.tillatna_kinds.filter((k) => k !== kind)
        : [...f.tillatna_kinds, kind],
    });
  }

  // ---- Agentnycklar (OpenClaw-gränsen: rotation = skapa ny + revokera) ----
  const [nycklar, setNycklar] = useState<NyckelRad[]>([]);
  const [nyNamn, setNyNamn] = useState("");
  const [nyModul, setNyModul] = useState("bokforing");
  const [nyScopes, setNyScopes] = useState<string[]>(["proposals:write"]);
  const [visadKlartext, setVisadKlartext] = useState<{ namn: string; nyckel: string } | null>(null);

  const laddaNycklar = useCallback(async (t: string) => {
    const r = await fetch(`/api/admin/nycklar?tenant=${t}`);
    setNycklar(await r.json());
  }, []);

  useEffect(() => {
    setVisadKlartext(null);
    laddaNycklar(tenant);
  }, [tenant, laddaNycklar]);

  async function skapaNyckel() {
    if (!nyNamn.trim()) return;
    setFel("");
    try {
      const r = await post<{ id: string; nyckel: string }>("/api/admin/nycklar", {
        tenant_id: tenant,
        module: nyModul,
        scopes: nyScopes,
        namn: nyNamn.trim(),
      });
      // Klartexten finns bara i detta svar — endast hashen är lagrad.
      setVisadKlartext({ namn: nyNamn.trim(), nyckel: r.nyckel });
      setNyNamn("");
      await laddaNycklar(tenant);
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    }
  }

  async function revokera(keyId: string) {
    setFel("");
    try {
      await fetch("/api/admin/nycklar", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_id: tenant, key_id: keyId }),
      });
      await laddaNycklar(tenant);
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="admin">
      <div className="topbar">
        <div className="wordmark-rad">
          <div className="wordmark">
            grund<em>bok</em>
          </div>
          <span className="undertitel">adminkonsol</span>
        </div>
        <div className="topbar-meta">
          <a className="tillbaka" href="/">
            ← till flödet
          </a>
          <select value={tenant} onChange={(e) => setTenant(e.target.value)}>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.namn} ({t.mall})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Godkännandekön */}
      <section className="steg">
        <div className="steg-rubrik">
          <span className="steg-titel">Godkännandekö</span>
          <span className="steg-not">
            {ko.length === 0 ? "tom" : `${ko.length} förslag väntar`} · diffen räknas om mot
            gällande policy vid varje hämtning
          </span>
        </div>

        {bekraftelse && (
          <div className="bokford" style={{ marginBottom: "var(--sp-3)" }}>
            {bekraftelse}
          </div>
        )}

        {ko.length === 0 && (
          <p className="tyst">Kön är tom — inga förslag väntar på mänskligt beslut.</p>
        )}

        {ko.map((k) => (
          <div key={k.id} className="ko-kort">
            <div className="ko-huvud">
              <span className="ko-summary">{k.summary}</span>
              <span className="tyst tid">{tid(k.created_at)}</span>
            </div>

            <div className="metarad">
              <span className="chip">{k.module}</span>
              <span className="chip">{k.kind}</span>
              <span className="chip">konfidens {Math.round(k.confidence * 100)} %</span>
              <span className="chip">hash {k.hash.slice(0, 12)}…</span>
              {k.belopp_ore > 0 && <span className="chip">{kr(k.belopp_ore)} kr</span>}
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

            <div className="diff-rubrik">Diff mot gällande policy</div>
            {k.missade_villkor.length === 0 ? (
              <p className="diff-ok">
                Uppfyller nu gällande policy — väntar ändå på mänskligt beslut.
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
                  onClick={() => besluta(k, "rejected", motivering)}
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
                  onClick={() => besluta(k, "approved")}
                  disabled={beslutarId !== null}
                >
                  {beslutarId === k.id ? "Bokför …" : "Godkänn"}
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
                  Beslutet binds till förslagets hash och din identitet — inget når ledgern
                  utan detta (ansvarsprincipen).
                </span>
              </div>
            )}
          </div>
        ))}
      </section>

      {/* Autonomipolicy */}
      <section className="steg">
        <div className="steg-rubrik">
          <span className="steg-titel">Autonomipolicy</span>
          <span className="steg-not">
            bor i kärnan, aldrig i agenten — allt utanför policyn hamnar i kön
          </span>
        </div>

        {POLICY_MODULER.map((modul) => {
          const f = former[modul];
          if (!f) return null;
          return (
            <div key={modul} className="policy-modul">
              <h3 className="policy-namn">{modul}</h3>
              <div className="policy-grid">
                <div className="policy-falt">
                  <label htmlFor={`${modul}-belopp`}>Max belopp (kr)</label>
                  <input
                    id={`${modul}-belopp`}
                    type="number"
                    min={0}
                    step={100}
                    value={f.max_belopp_kr}
                    onChange={(e) => uppdateraForm(modul, { max_belopp_kr: e.target.value })}
                  />
                </div>
                <div className="policy-falt">
                  <label htmlFor={`${modul}-konfidens`}>Min konfidens (0–1)</label>
                  <input
                    id={`${modul}-konfidens`}
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={f.min_confidence}
                    onChange={(e) => uppdateraForm(modul, { min_confidence: e.target.value })}
                  />
                </div>
                <div className="policy-falt">
                  <label htmlFor={`${modul}-motpart`}>Motpartskrav</label>
                  <span className="check-val">
                    <input
                      id={`${modul}-motpart`}
                      type="checkbox"
                      checked={f.kanda_motparter_endast}
                      onChange={(e) =>
                        uppdateraForm(modul, { kanda_motparter_endast: e.target.checked })
                      }
                    />
                    endast kända motparter
                  </span>
                </div>
              </div>

              <div className="policy-falt">
                <label>Tillåtna kinds för auto-godkännande</label>
                <div className="kind-rad">
                  {PROPOSAL_KINDS.map((kind) => (
                    <span key={kind} className="check-val">
                      <input
                        id={`${modul}-${kind}`}
                        type="checkbox"
                        checked={f.tillatna_kinds.includes(kind)}
                        onChange={() => vaxlaKind(modul, kind)}
                      />
                      <label htmlFor={`${modul}-${kind}`} style={{ all: "unset", cursor: "pointer" }}>
                        {kind}
                      </label>
                      {kind === "correction" && (
                        <span className="kind-not">
                          — auto-godkänns aldrig oavsett bocken (hård regel i motorn)
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>

              <div className="beslutsrad" style={{ marginTop: 0 }}>
                <button className="primar" onClick={() => sparaPolicyForm(modul)}>
                  Spara policy för {modul}
                </button>
                {policySparat[modul] && <span className="sparat">{policySparat[modul]}</span>}
              </div>
            </div>
          );
        })}
      </section>

      {/* Agentnycklar */}
      <section className="steg">
        <div className="steg-rubrik">
          <span className="steg-titel">Agentnycklar</span>
          <span className="steg-not">
            en nyckel per agent hos kund — kan skapa förslag för sin tenant/modul, aldrig
            bokföra · rotation = skapa ny + revokera gammal
          </span>
        </div>

        {visadKlartext && (
          <div className="bokford" style={{ marginBottom: "var(--sp-3)" }}>
            Nyckel för <strong>{visadKlartext.namn}</strong> — kopiera nu, den visas aldrig
            igen (endast hashen lagras):
            <div className="nyckel-klartext">{visadKlartext.nyckel}</div>
          </div>
        )}

        <div className="nyckel-skapa">
          <input
            type="text"
            value={nyNamn}
            onChange={(e) => setNyNamn(e.target.value)}
            placeholder="Agentens namn, t.ex. kvittoagent-butik-2"
          />
          <select value={nyModul} onChange={(e) => setNyModul(e.target.value)}>
            {POLICY_MODULER.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          {NYCKEL_SCOPES.map((scope) => (
            <span key={scope} className="check-val">
              <input
                id={`scope-${scope}`}
                type="checkbox"
                checked={nyScopes.includes(scope)}
                onChange={() =>
                  setNyScopes((s) =>
                    s.includes(scope) ? s.filter((x) => x !== scope) : [...s, scope],
                  )
                }
              />
              <label htmlFor={`scope-${scope}`} style={{ all: "unset", cursor: "pointer" }}>
                {scope}
              </label>
            </span>
          ))}
          <button className="primar" onClick={skapaNyckel} disabled={!nyNamn.trim() || nyScopes.length === 0}>
            Skapa nyckel
          </button>
        </div>

        {nycklar.length === 0 ? (
          <p className="tyst">Inga agentnycklar för den här tenanten.</p>
        ) : (
          <table className="rader">
            <thead>
              <tr>
                <th>Namn</th>
                <th>Modul</th>
                <th>Scopes</th>
                <th>Skapad</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {nycklar.map((n) => (
                <tr key={n.id}>
                  <td>{n.namn}</td>
                  <td>{n.module}</td>
                  <td>{n.scopes.map((s) => <span key={s} className="chip">{s}</span>)}</td>
                  <td className="tal">{tid(n.created_at)}</td>
                  <td>{n.active ? "aktiv" : <span className="tyst">revokerad</span>}</td>
                  <td>
                    {n.active && (
                      <button onClick={() => revokera(n.id)}>Revokera</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Beslutslogg */}
      <section className="steg">
        <div className="steg-rubrik">
          <span className="steg-titel">Beslutslogg</span>
          <span className="steg-not">append-only — senaste 50, nyast först</span>
        </div>

        {logg.length === 0 ? (
          <p className="tyst">Inga beslut ännu för den här tenanten.</p>
        ) : (
          <table className="rader">
            <thead>
              <tr>
                <th>Tid</th>
                <th>Modul</th>
                <th>Typ</th>
                <th>Förslag</th>
                <th>Beslut</th>
                <th className="tal">Ver.nr</th>
                <th>Modell</th>
              </tr>
            </thead>
            <tbody>
              {logg.map((l) => (
                <tr key={`${l.proposal_id}-${l.decided_at}`}>
                  <td className="tal">{tid(l.decided_at)}</td>
                  <td>{l.module}</td>
                  <td>{l.kind}</td>
                  <td>{l.summary}</td>
                  <td>
                    {l.outcome === "auto_approved" ? (
                      <>
                        <span className="chip">policy</span>{" "}
                        <span className="tyst">{l.decided_by}</span>
                      </>
                    ) : l.outcome === "approved" ? (
                      <>
                        godkänd <span className="tyst">· {l.decided_by}</span>
                      </>
                    ) : (
                      <>
                        avvisad{" "}
                        <span className="tyst">
                          · {l.decided_by}
                          {l.reason ? ` — ${l.reason}` : ""}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="tal">{l.verifikationsnummer ?? "—"}</td>
                  <td>
                    {l.model}
                    {l.agent_runtime ? (
                      <>
                        {" "}
                        <span className="chip">{l.agent_runtime}</span>
                      </>
                    ) : (
                      <span className="tyst"> · intern</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {fel && <p className="fel">{fel}</p>}

      <footer>
        Adminkonsolen fattar beslut genom samma hash-bundna beslutsmotor som API:t —
        auto-godkännande är en policyinställning i kärnan, aldrig en egenskap hos agenten
        (ADR-0002).
      </footer>
    </main>
  );
}
