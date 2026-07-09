"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import "./operator.css";

// Operatörskonsolen (WP14) — grundarens vy: bolag → agenter → status,
// provisionering med policymall, nyckelrotation som ETT flöde, hälsa.
// Regeln från masterplanen: attest bor hos byrån, drift hos operatören —
// här visas AGGREGAT, aldrig kvitton, belopp eller förslags-innehåll.

type BolagsRad = {
  byra: string;
  tenant_id: string;
  tenant_namn: string;
  mall: string;
  agenter_aktiva: number;
  agenter_pausade: number;
  forslag_7d: number;
  beslut_7d: number;
};

type AgentVy = {
  id: string;
  module: string;
  namn: string;
  scopes: string[];
  status: "active" | "paused" | "canceled";
  created_at: string;
};

type PolicyMall = {
  id: string;
  namn: string;
  module: string;
  max_belopp_ore: number;
  min_confidence: number;
  kanda_motparter_endast: boolean;
  tillatna_kinds: string[];
};

type Halsa = { ko_djup: number; senaste_korning: string | null; omforsok_24h: number };

const tid = (iso: string) =>
  new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });

async function post<T>(url: string, body: unknown, metod = "POST"): Promise<T> {
  const r = await fetch(url, {
    method: metod,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.status === 401) {
    // Utgången session mitt i driften: tillbaka till inloggningen.
    window.location.href = "/login?next=/operator";
    throw new Error("sessionen har gått ut — du skickas till inloggningen");
  }
  const data = await r.json();
  if (!r.ok) {
    const fel = (data as { fel?: string | string[] }).fel;
    throw new Error(Array.isArray(fel) ? fel.join("; ") : (fel ?? `HTTP ${r.status}`));
  }
  return data as T;
}

export default function OperatorSida() {
  const router = useRouter();
  const [inloggad, setInloggad] = useState(false);
  const [bolag, setBolag] = useState<BolagsRad[]>([]);
  const [valtBolag, setValtBolag] = useState<string | null>(null);
  const [agenter, setAgenter] = useState<AgentVy[]>([]);
  const [mallar, setMallar] = useState<PolicyMall[]>([]);
  const [halsa, setHalsa] = useState<Halsa | null>(null);
  const [fel, setFel] = useState("");

  // Provisioneringsflödet: mall → namn → nyckel (visas en gång).
  const [nyMall, setNyMall] = useState<string>("");
  const [nyNamn, setNyNamn] = useState("");
  const [visadNyckel, setVisadNyckel] = useState<{ rubrik: string; nyckel: string } | null>(null);
  const [arbetar, setArbetar] = useState(false);

  // Mall-redigering: formulärstate per mall-id ("" = ny mall).
  const [mallFormer, setMallFormer] = useState<
    Record<string, { namn: string; belopp_kr: string; konfidens: string; kanda: boolean; auto: boolean }>
  >({});
  const [mallSparat, setMallSparat] = useState<Record<string, string>>({});

  const laddaBolag = useCallback(async () => {
    const r = await fetch("/api/operator/bolag");
    if (!r.ok) {
      router.push("/login?next=/operator");
      return false;
    }
    setBolag(await r.json());
    return true;
  }, [router]);

  const laddaMallar = useCallback(async () => {
    const r = await fetch("/api/operator/mallar");
    if (!r.ok) return;
    const m = (await r.json()) as PolicyMall[];
    setMallar(m);
    setMallFormer((s) => {
      const nya: typeof s = { "": s[""] ?? { namn: "", belopp_kr: "0", konfidens: "1", kanda: true, auto: false } };
      for (const mall of m) {
        nya[mall.id] = {
          namn: mall.namn,
          belopp_kr: String(mall.max_belopp_ore / 100),
          konfidens: String(mall.min_confidence),
          kanda: mall.kanda_motparter_endast,
          auto: mall.tillatna_kinds.includes("journal_entry"),
        };
      }
      return nya;
    });
  }, []);

  const laddaHalsa = useCallback(async () => {
    const r = await fetch("/api/operator/halsa");
    if (r.ok) setHalsa(await r.json());
  }, []);

  const laddaAgenter = useCallback(async (tenant: string) => {
    const r = await fetch(`/api/agents?tenant=${tenant}`);
    if (r.ok) setAgenter(await r.json());
  }, []);

  useEffect(() => {
    (async () => {
      if (await laddaBolag()) {
        setInloggad(true);
        laddaMallar();
        laddaHalsa();
      }
    })();
  }, [laddaBolag, laddaMallar, laddaHalsa]);

  useEffect(() => {
    setVisadNyckel(null);
    setFel("");
    if (valtBolag) laddaAgenter(valtBolag);
  }, [valtBolag, laddaAgenter]);

  async function loggaUt() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function provisionera() {
    if (!valtBolag || !nyNamn.trim()) return;
    setArbetar(true);
    setFel("");
    try {
      const r = await post<{ agent_id: string; nyckel: string }>("/api/agents", {
        tenant_id: valtBolag,
        display_name: nyNamn.trim(),
        ...(nyMall ? { mall_id: nyMall } : { module: "bokforing" }),
      });
      setVisadNyckel({ rubrik: `Nyckel för ${nyNamn.trim()}`, nyckel: r.nyckel });
      setNyNamn("");
      await Promise.all([laddaAgenter(valtBolag), laddaBolag()]);
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    } finally {
      setArbetar(false);
    }
  }

  async function rotera(agent: AgentVy) {
    if (!valtBolag) return;
    const ok = window.confirm(
      `Rotera nyckeln för ${agent.namn}? En ny agent med samma konfiguration skapas och den gamla avslutas — den gamla nyckeln slutar gälla direkt.`,
    );
    if (!ok) return;
    setArbetar(true);
    setFel("");
    try {
      const r = await post<{ agent_id: string; nyckel: string }>(
        `/api/agents/${agent.id}/rotera`,
        { tenant_id: valtBolag },
      );
      setVisadNyckel({ rubrik: `Ny nyckel för ${agent.namn} (rotation)`, nyckel: r.nyckel });
      await Promise.all([laddaAgenter(valtBolag), laddaBolag()]);
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    } finally {
      setArbetar(false);
    }
  }

  async function sattStatus(agentId: string, metod: "DELETE" | "PATCH", status?: "paused" | "active") {
    if (!valtBolag) return;
    setFel("");
    try {
      await post(`/api/agents/${agentId}`, { tenant_id: valtBolag, status }, metod);
      await Promise.all([laddaAgenter(valtBolag), laddaBolag()]);
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    }
  }

  async function sparaMall(id: string) {
    const f = mallFormer[id];
    if (!f?.namn.trim()) return;
    setFel("");
    setMallSparat((s) => ({ ...s, [id]: "" }));

    const beloppKr = Number(f.belopp_kr.replace(/\s/g, "").replace(",", "."));
    const minConf = Number(f.konfidens.replace(",", "."));
    if (!Number.isFinite(beloppKr) || beloppKr < 0 || !Number.isFinite(minConf) || minConf < 0 || minConf > 1) {
      setFel("mall: belopp ≥ 0 kr och konfidens mellan 0 och 1 krävs");
      return;
    }

    try {
      await post("/api/operator/mallar", {
        ...(id ? { id } : {}),
        namn: f.namn.trim(),
        module: "bokforing",
        max_belopp_ore: Math.round(beloppKr * 100),
        min_confidence: minConf,
        kanda_motparter_endast: f.kanda,
        tillatna_kinds: f.auto ? ["journal_entry"] : [],
      });
      setMallSparat((s) => ({ ...s, [id]: "sparad" }));
      await laddaMallar();
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    }
  }

  function uppdateraMall(id: string, patch: Partial<(typeof mallFormer)[string]>) {
    setMallFormer((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
    setMallSparat((s) => ({ ...s, [id]: "" }));
  }

  if (!inloggad) {
    return (
      <main className="operator">
        <p className="laddar">laddar …</p>
      </main>
    );
  }

  const bolagsNamn = bolag.find((b) => b.tenant_id === valtBolag)?.tenant_namn;

  return (
    <main className="operator">
      <div className="topbar">
        <div className="wordmark-rad">
          <div className="wordmark">
            grund<em>bok</em>
          </div>
          <span className="undertitel">operatörskonsol</span>
        </div>
        <div className="topbar-meta">
          <button onClick={loggaUt}>Logga ut</button>
        </div>
      </div>

      {/* Hälsa */}
      <section className="steg">
        <div className="steg-rubrik">
          <span className="steg-titel">Hälsa</span>
          <span className="steg-not">kön och workern — drift, aldrig innehåll</span>
        </div>
        {halsa && (
          <div className="halsa-rad">
            <div className="halsa-kort">
              <div className="varde">{halsa.ko_djup}</div>
              <div className="etikett">jobb i kön</div>
            </div>
            <div className="halsa-kort">
              <div className="varde">{halsa.senaste_korning ? tid(halsa.senaste_korning) : "—"}</div>
              <div className="etikett">senaste worker-körning</div>
            </div>
            <div className="halsa-kort">
              <div className="varde">{halsa.omforsok_24h}</div>
              <div className="etikett">omförsök senaste dygnet</div>
            </div>
          </div>
        )}
      </section>

      {/* Bolag */}
      <section className="steg">
        <div className="steg-rubrik">
          <span className="steg-titel">Bolag</span>
          <span className="steg-not">
            byråer → klientbolag → agenter · antal förslag är drift, innehållet är byråns
          </span>
        </div>
        {bolag.length === 0 ? (
          <p className="tyst">Inga bolag ännu — provisionera det första när en byrå skrivit på.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="rader">
              <thead>
                <tr>
                  <th>Byrå</th>
                  <th>Klientbolag</th>
                  <th>Mall</th>
                  <th className="tal">Agenter</th>
                  <th className="tal">Förslag 7 d</th>
                  <th className="tal">Beslut 7 d</th>
                </tr>
              </thead>
              <tbody>
                {bolag.map((b) => (
                  <tr
                    key={b.tenant_id}
                    data-vald={valtBolag === b.tenant_id}
                    onClick={() => setValtBolag(b.tenant_id)}
                  >
                    <td>{b.byra}</td>
                    <td>{b.tenant_namn}</td>
                    <td>{b.mall}</td>
                    <td className="tal">
                      {b.agenter_aktiva}
                      {b.agenter_pausade > 0 && (
                        <span className="tyst"> (+{b.agenter_pausade} pausade)</span>
                      )}
                    </td>
                    <td className="tal">{b.forslag_7d}</td>
                    <td className="tal">{b.beslut_7d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Agenter för valt bolag */}
      <section className="steg" data-inaktiv={!valtBolag}>
        <div className="steg-rubrik">
          <span className="steg-titel">
            Agenter{bolagsNamn ? ` — ${bolagsNamn}` : ""}
          </span>
          <span className="steg-not">
            en agent är en rad, inte en maskin (ADR-0003) · nyckeln kan föreslå, aldrig bokföra
          </span>
        </div>

        {!valtBolag && <p className="tyst">Välj ett bolag i tabellen ovan.</p>}

        {valtBolag && (
          <>
            {visadNyckel && (
              <div className="bokford" style={{ marginBottom: "var(--sp-3)" }}>
                {visadNyckel.rubrik} —{" "}
                <span className="nyckel-varning">
                  kopiera nu, den visas aldrig igen (endast hashen lagras):
                </span>
                <div className="nyckel-klartext">{visadNyckel.nyckel}</div>
                <button
                  style={{ marginTop: "var(--sp-2)" }}
                  onClick={() => navigator.clipboard.writeText(visadNyckel.nyckel)}
                >
                  Kopiera nyckeln
                </button>
              </div>
            )}

            <div className="provisionera-rad">
              <select value={nyMall} onChange={(e) => setNyMall(e.target.value)}>
                <option value="">utan mall (bokforing, manuell policy)</option>
                {mallar.map((m) => (
                  <option key={m.id} value={m.id}>
                    mall: {m.namn}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={nyNamn}
                onChange={(e) => setNyNamn(e.target.value)}
                placeholder="Agentens namn, t.ex. kvittoagent-butik-2"
              />
              <button className="primar" onClick={provisionera} disabled={arbetar || !nyNamn.trim()}>
                {arbetar ? "Provisionerar …" : "Provisionera agent"}
              </button>
            </div>

            {agenter.length === 0 ? (
              <p className="tyst">
                Inga agenter för det här bolaget ännu — provisionera den första ovan.
              </p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="rader">
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>Modul</th>
                      <th>Scopes</th>
                      <th>Skapad</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {agenter.map((a) => (
                      <tr key={a.id} className="ej-klickbar">
                        <td>{a.namn}</td>
                        <td>{a.module}</td>
                        <td>
                          {a.scopes.map((s) => (
                            <span key={s} className="chip">
                              {s}
                            </span>
                          ))}
                        </td>
                        <td className="tal">{tid(a.created_at)}</td>
                        <td>
                          {a.status === "active" && "aktiv"}
                          {a.status === "paused" && <span className="tyst">pausad</span>}
                          {a.status === "canceled" && <span className="tyst">avslutad</span>}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {a.status === "active" && (
                            <>
                              <button onClick={() => sattStatus(a.id, "PATCH", "paused")}>Pausa</button>{" "}
                              <button onClick={() => rotera(a)} disabled={arbetar}>
                                Rotera nyckel
                              </button>{" "}
                            </>
                          )}
                          {a.status === "paused" && (
                            <button onClick={() => sattStatus(a.id, "PATCH", "active")}>
                              Återuppta
                            </button>
                          )}{" "}
                          {a.status !== "canceled" && (
                            <button onClick={() => sattStatus(a.id, "DELETE")}>Avsluta</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {/* Policymallar */}
      <section className="steg">
        <div className="steg-rubrik">
          <span className="steg-titel">Policymallar</span>
          <span className="steg-not">
            väljs vid provisionering och kopieras till bolagets policy — byrån kan
            sedan justera i sin arbetsyta
          </span>
        </div>

        {[...mallar.map((m) => m.id), ""].map((id) => {
          const f = mallFormer[id];
          if (!f) return null;
          return (
            <div key={id || "ny"} className="mall-rad">
              {id ? (
                <span className="mall-namn">{f.namn}</span>
              ) : (
                <input
                  type="text"
                  value={f.namn}
                  onChange={(e) => uppdateraMall(id, { namn: e.target.value })}
                  placeholder="Ny mall, t.ex. Detaljhandel — standard"
                />
              )}
              <span className="check-val">
                <input
                  id={`mall-${id || "ny"}-auto`}
                  type="checkbox"
                  checked={f.auto}
                  onChange={(e) => uppdateraMall(id, { auto: e.target.checked })}
                />
                <label htmlFor={`mall-${id || "ny"}-auto`} style={{ all: "unset", cursor: "pointer" }}>
                  bokför själv upp till
                </label>
              </span>
              <input
                type="number"
                min={0}
                step={100}
                value={f.belopp_kr}
                onChange={(e) => uppdateraMall(id, { belopp_kr: e.target.value })}
                aria-label="max belopp i kronor"
              />
              kr
              <span className="check-val">
                <input
                  id={`mall-${id || "ny"}-kanda`}
                  type="checkbox"
                  checked={f.kanda}
                  onChange={(e) => uppdateraMall(id, { kanda: e.target.checked })}
                />
                <label htmlFor={`mall-${id || "ny"}-kanda`} style={{ all: "unset", cursor: "pointer" }}>
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
                  onChange={(e) => uppdateraMall(id, { konfidens: e.target.value })}
                  aria-label="min konfidens (0–1)"
                />
                i konfidens
              </span>
              <button onClick={() => sparaMall(id)} disabled={!f.namn.trim()}>
                {id ? "Spara" : "Skapa mall"}
              </button>
              {mallSparat[id] && <span className="sparat">{mallSparat[id]}</span>}
            </div>
          );
        })}
      </section>

      {fel && <p className="fel">{fel}</p>}

      <footer>
        Operatören driftar — provisionerar, pausar, roterar — men attesterar aldrig:
        kvitton, belopp och beslut bor hos byrån (masterplanens ansvarsfördelning).
      </footer>
    </main>
  );
}
