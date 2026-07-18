"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { plexMono } from "../_publik/fonter";
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

// Flottöversikten (WP13, ADR-0004) — speglar FlottRad/AgentDetalj i
// src/ytor/operator.ts: aggregat och driftmetadata, aldrig innehåll.
type FlottVarning = "inaktiv_7d" | "hog_korrigeringsandel" | "versionsdrift";

type FlottRad = {
  agent_id: string;
  byra: string;
  tenant_id: string;
  tenant_namn: string;
  display_name: string;
  module: string;
  template_id: string | null;
  template_version: string;
  mall_aktuell_version: string | null;
  status: "active" | "paused" | "canceled";
  forslag_7d: number;
  auto_7d: number;
  rejected_7d: number;
  corrected_7d: number;
  andel_auto: number | null;
  andel_korrigerade: number | null;
  senaste_aktivitet: string | null;
  varningar: FlottVarning[];
};

type AgentDetalj = {
  agent: FlottRad & {
    scopes: string[];
    max_concurrency: number;
    provisioned_by: string;
    skapad: string;
  };
  policy: {
    max_belopp_ore: number;
    min_confidence: number;
    kanda_motparter_endast: boolean;
    tillatna_kinds: string[];
  } | null;
  senaste: {
    id: string;
    kind: string;
    status: string;
    confidence: number;
    mall_version: string | null;
    skapad: string;
  }[];
};

/** Katalogmetadata från /api/operator/agentmallar — aldrig registret
 *  självt i klienten: systemPrompt/regler ska inte in i en publik bundle. */
type AgentmallVal = { id: string; displayName: string; version: string };

const VARNINGSTEXT: Record<FlottVarning, string> = {
  inaktiv_7d: "ingen aktivitet 7 d",
  hog_korrigeringsandel: "hög korrigeringsandel",
  versionsdrift: "versionsdrift",
};

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)} %`);

/** Filtervärde för mall-lösa agenter — kolliderar aldrig med ett mall-id. */
const UTAN_MALL = "__utan_mall__";

/** Mall + version för tabellen: registrets exakta version när pekaren
 *  löser, annars major-pekaren (versionsdriften får sin varningschip). */
const mallEtikett = (r: FlottRad) =>
  r.template_id
    ? `${r.template_id} ${r.mall_aktuell_version ?? `v${r.template_version}`}`
    : `${r.module} (utan mall)`;

const tid = (iso: string) =>
  new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });

// Bakgrundshämtningar: utgången session → inloggningen, inte tyst
// gammal data (samma mönster som /byra, Bugbot PR #2).
async function hamta<T>(url: string): Promise<T | null> {
  const r = await fetch(url);
  if (r.status === 401) {
    window.location.href = "/login?next=/operator";
    return null;
  }
  if (!r.ok) return null;
  return (await r.json()) as T;
}

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

  // Flottan (WP13): filtrering på mall + status, radklick → detalj.
  const [flotta, setFlotta] = useState<FlottRad[]>([]);
  const [filtMall, setFiltMall] = useState("");
  const [filtStatus, setFiltStatus] = useState("");
  const [valdAgent, setValdAgent] = useState<string | null>(null);
  const [detalj, setDetalj] = useState<AgentDetalj | null>(null);
  const [agentmallar, setAgentmallar] = useState<AgentmallVal[]>([]);

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
    const m = await hamta<PolicyMall[]>("/api/operator/mallar");
    if (!m) return;
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
    const h = await hamta<Halsa>("/api/operator/halsa");
    if (h) setHalsa(h);
  }, []);

  const laddaAgenter = useCallback(async (tenant: string) => {
    const a = await hamta<AgentVy[]>(`/api/agents?tenant=${tenant}`);
    if (a) setAgenter(a);
  }, []);

  const laddaFlotta = useCallback(async () => {
    const f = await hamta<FlottRad[]>("/api/operator/flotta");
    if (f) setFlotta(f);
  }, []);

  const laddaAgentmallar = useCallback(async () => {
    const m = await hamta<AgentmallVal[]>("/api/operator/agentmallar");
    if (m) setAgentmallar(m);
  }, []);

  const laddaDetalj = useCallback(async (agentId: string) => {
    const d = await hamta<AgentDetalj>(`/api/operator/flotta/${agentId}`);
    setDetalj(d);
  }, []);

  useEffect(() => {
    (async () => {
      if (await laddaBolag()) {
        setInloggad(true);
        laddaMallar();
        laddaHalsa();
        laddaFlotta();
        laddaAgentmallar();
      }
    })();
  }, [laddaBolag, laddaMallar, laddaHalsa, laddaFlotta, laddaAgentmallar]);

  useEffect(() => {
    setVisadNyckel(null);
    setFel("");
    if (valtBolag) laddaAgenter(valtBolag);
  }, [valtBolag, laddaAgenter]);

  useEffect(() => {
    setDetalj(null);
    if (valdAgent) laddaDetalj(valdAgent);
  }, [valdAgent, laddaDetalj]);

  async function loggaUt() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function provisionera() {
    if (!valtBolag || !nyNamn.trim()) return;
    setArbetar(true);
    setFel("");
    try {
      // Tre vägar: agentmall (versionerad, ADR-0004), policymall (WP14)
      // eller rå bokforing-modul utan mall.
      const r = await post<{ agent_id: string; nyckel: string }>("/api/agents", {
        tenant_id: valtBolag,
        display_name: nyNamn.trim(),
        ...(nyMall.startsWith("agentmall:")
          ? { agentmall: nyMall.slice("agentmall:".length) }
          : nyMall
            ? { mall_id: nyMall }
            : { module: "bokforing" }),
      });
      setVisadNyckel({ rubrik: `Nyckel för ${nyNamn.trim()}`, nyckel: r.nyckel });
      setNyNamn("");
      await Promise.all([laddaAgenter(valtBolag), laddaBolag(), laddaFlotta()]);
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
      await Promise.all([laddaAgenter(valtBolag), laddaBolag(), laddaFlotta()]);
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
      await Promise.all([laddaAgenter(valtBolag), laddaBolag(), laddaFlotta()]);
      // Samma agent kan stå öppen i flottans detaljpanel — håll den synkad.
      if (valdAgent === agentId) await laddaDetalj(agentId);
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    }
  }

  // Flottans enda skrivväg (WP13): pausa/återuppta via samma PATCH som
  // agentsektionen — tenanten kommer ur flottraden, inte bolagsvalet.
  async function sattFlottStatus(rad: FlottRad, status: "paused" | "active") {
    setFel("");
    try {
      await post(`/api/agents/${rad.agent_id}`, { tenant_id: rad.tenant_id, status }, "PATCH");
      await Promise.all([laddaFlotta(), laddaBolag()]);
      if (valdAgent) await laddaDetalj(valdAgent);
      if (valtBolag === rad.tenant_id) await laddaAgenter(rad.tenant_id);
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
      <main className={`operator ${plexMono.variable}`}>
        <p className="laddar">laddar …</p>
      </main>
    );
  }

  const bolagsNamn = bolag.find((b) => b.tenant_id === valtBolag)?.tenant_namn;

  // Flottans filter + fasta sortering: korrigeringsandel fallande — hög
  // andel överst, det är den raden som behöver ses över (kickoff WP13).
  const mallVal = [...new Set(flotta.map((r) => r.template_id ?? UTAN_MALL))].sort();
  const visadFlotta = flotta
    .filter((r) => !filtMall || (r.template_id ?? UTAN_MALL) === filtMall)
    .filter((r) => !filtStatus || r.status === filtStatus)
    .sort((a, b) => (b.andel_korrigerade ?? -1) - (a.andel_korrigerade ?? -1));

  return (
    <main className={`operator ${plexMono.variable}`}>
      <h1 className="sr-rubrik">Operatörskonsolen</h1>
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
          <h2 className="steg-titel">Hälsa</h2>
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

      {/* Flottan (WP13, ADR-0004) */}
      <section className="steg">
        <div className="steg-rubrik">
          <span className="steg-titel">Flottan</span>
          <span className="steg-not">
            alla agenter, sorterade på korrigeringsandel — hög andel betyder att mallen
            eller kontexten behöver ses över
          </span>
        </div>

        <div className="filter-rad">
          <select
            value={filtMall}
            onChange={(e) => setFiltMall(e.target.value)}
            aria-label="filtrera på mall"
          >
            <option value="">alla mallar</option>
            {mallVal.map((m) => (
              <option key={m} value={m}>
                {m === UTAN_MALL ? "(utan mall)" : m}
              </option>
            ))}
          </select>
          <select
            value={filtStatus}
            onChange={(e) => setFiltStatus(e.target.value)}
            aria-label="filtrera på status"
          >
            <option value="">alla statusar</option>
            <option value="active">aktiva</option>
            <option value="paused">pausade</option>
            <option value="canceled">avslutade</option>
          </select>
        </div>

        {visadFlotta.length === 0 ? (
          <p className="tyst">
            {flotta.length === 0
              ? "Inga agenter i flottan ännu — provisionera den första under ett bolag nedan."
              : "Inga agenter matchar filtret."}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="rader">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Klientbolag</th>
                  <th>Mall</th>
                  <th>Status</th>
                  <th className="tal">Förslag 7 d</th>
                  <th className="tal">Auto</th>
                  <th className="tal">Korrigerade</th>
                  <th className="tal">Senast aktiv</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visadFlotta.map((r) => (
                  <tr
                    key={r.agent_id}
                    data-vald={valdAgent === r.agent_id}
                    onClick={() => setValdAgent(valdAgent === r.agent_id ? null : r.agent_id)}
                  >
                    <td>{r.display_name}</td>
                    <td>
                      {r.tenant_namn} <span className="tyst">({r.byra})</span>
                    </td>
                    <td>{mallEtikett(r)}</td>
                    <td>
                      {r.status === "active" && "aktiv"}
                      {r.status === "paused" && <span className="tyst">pausad</span>}
                      {r.status === "canceled" && <span className="tyst">avslutad</span>}
                    </td>
                    <td className="tal">{r.forslag_7d}</td>
                    <td className="tal">{pct(r.andel_auto)}</td>
                    <td className="tal">{pct(r.andel_korrigerade)}</td>
                    <td className="tal">{r.senaste_aktivitet ? tid(r.senaste_aktivitet) : "—"}</td>
                    <td>
                      {r.varningar.map((v) => (
                        <span key={v} className="chip chip-varning">
                          {VARNINGSTEXT[v]}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Renderingsvakt mot stale-response-racen: en detalj som hann
            hämtas för en TIDIGARE vald rad renderas aldrig — knapparna
            kan därmed aldrig agera på fel agent. */}
        {valdAgent && detalj && detalj.agent.agent_id === valdAgent && (
          <div className="flotta-detalj">
            <div className="detalj-rubrik">
              <strong>{detalj.agent.display_name}</strong>
              <span className="tyst">
                {detalj.agent.tenant_namn} · {mallEtikett(detalj.agent)} · provisionerad{" "}
                {tid(detalj.agent.skapad)} av {detalj.agent.provisioned_by}
              </span>
              {detalj.agent.status === "active" && (
                <button onClick={() => sattFlottStatus(detalj.agent, "paused")}>Pausa</button>
              )}
              {detalj.agent.status === "paused" && (
                <button onClick={() => sattFlottStatus(detalj.agent, "active")}>Återuppta</button>
              )}
            </div>

            <p className="policy-rad">
              policy:{" "}
              {detalj.policy
                ? `bokför själv upp till ${(detalj.policy.max_belopp_ore / 100).toLocaleString(
                    "sv-SE",
                  )} kr · minst ${detalj.policy.min_confidence} i konfidens · ${
                    detalj.policy.kanda_motparter_endast ? "endast kända motparter" : "alla motparter"
                  } · kinds: ${
                    detalj.policy.tillatna_kinds.join(", ") || "inga (allt attesteras)"
                  }`
                : "ingen autonomipolicy — allt attesteras"}
              {" · scopes: "}
              {detalj.agent.scopes.map((s) => (
                <span key={s} className="chip">
                  {s}
                </span>
              ))}
            </p>

            {detalj.senaste.length === 0 ? (
              <p className="tyst">Inga förslag från den här agenten ännu.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="rader">
                  <thead>
                    <tr>
                      <th>Förslag</th>
                      <th>Kind</th>
                      <th>Status</th>
                      <th className="tal">Konfidens</th>
                      <th>Mallversion</th>
                      <th className="tal">Skapat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalj.senaste.map((p) => (
                      <tr key={p.id} className="ej-klickbar">
                        <td className="tal">{p.id.slice(0, 8)}</td>
                        <td>{p.kind}</td>
                        <td>{p.status}</td>
                        <td className="tal">{p.confidence.toFixed(2)}</td>
                        <td>{p.mall_version ?? <span className="tyst">ostämplad</span>}</td>
                        <td className="tal">{tid(p.skapad)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Bolag */}
      <section className="steg">
        <div className="steg-rubrik">
          <h2 className="steg-titel">Bolag</h2>
          <span className="steg-not">
            byråer → klientbolag → agenter · antal förslag är drift, innehållet är byråns
          </span>
        </div>
        {bolag.length === 0 ? (
          <p className="tyst">Inga bolag ännu — provisionera det första när en byrå skrivit på.</p>
        ) : (
          <div className="svep">
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
                    <td>
                      {/* Det tangentbordsnåbara valet — radens onClick är
                          bara en större pekyta för samma sak. */}
                      <button
                        className="valj-bolag"
                        aria-pressed={valtBolag === b.tenant_id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setValtBolag(b.tenant_id);
                        }}
                      >
                        {b.tenant_namn}
                      </button>
                    </td>
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
          <h2 className="steg-titel">
            Agenter{bolagsNamn ? ` — ${bolagsNamn}` : ""}
          </h2>
          <span className="steg-not">
            en agent är en rad, inte en maskin (ADR-0003) · nyckeln kan föreslå, aldrig bokföra
          </span>
        </div>

        {!valtBolag && <p className="tyst">Välj ett bolag i tabellen ovan.</p>}

        {valtBolag && (
          <>
            {visadNyckel && (
              <div className="nyckel-avslojande">
                {visadNyckel.rubrik} —{" "}
                <span className="nyckel-varning">
                  kopiera nu, den visas aldrig igen (endast hashen lagras):
                </span>
                <div className="nyckel-klartext">{visadNyckel.nyckel}</div>
                <button
                  className="nyckel-kopiera"
                  onClick={() => navigator.clipboard.writeText(visadNyckel.nyckel)}
                >
                  Kopiera nyckeln
                </button>
              </div>
            )}

            <div className="provisionera-rad">
              <select value={nyMall} onChange={(e) => setNyMall(e.target.value)}>
                <option value="">utan mall (bokforing, manuell policy)</option>
                <optgroup label="agentmallar — versionerade hjärnor (ADR-0004)">
                  {agentmallar.map((m) => (
                    <option key={m.id} value={`agentmall:${m.id}`}>
                      {m.displayName} · {m.version}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="policymallar — endast autonomi">
                  {mallar.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.namn}
                    </option>
                  ))}
                </optgroup>
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
              <div className="svep">
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
                        <td className="atgarder">
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
          <h2 className="steg-titel">Policymallar</h2>
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
                <label htmlFor={`mall-${id || "ny"}-auto`}>
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
                <label htmlFor={`mall-${id || "ny"}-kanda`}>
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
