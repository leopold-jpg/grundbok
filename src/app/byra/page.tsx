"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EXEMPEL } from "@/lib/exempel";
import { plexMono } from "../_publik/fonter";
import {
  attestMaskin,
  nyttLage,
  type AttestBeslut,
  type AttestHandelse,
  type AttestLage,
} from "@/ytor/komponenter/attest-tangentbord";
import { byggKommandon, type Kommando } from "@/ytor/komponenter/kommandon";
import { KommandoPalett, useKommandoGenvag } from "@/ytor/komponenter/KommandoPalett";
import { Chip } from "@/ytor/komponenter/Chip";
import { StatusPunkt, type AgentStatus } from "@/ytor/komponenter/StatusPunkt";
import { TomtLage } from "@/ytor/komponenter/TomtLage";
import "../../ytor/komponenter/komponenter.css";
import "./byra.css";

// Byråns arbetsyta (WP13, ombyggd attestkö i WP26) — produkten.
// Inloggad konsult ser SIN byrås värld: attestkön (radlista +
// detaljpanel i sidled, tangentbordsstyrd), manuellt intag, chatten,
// beslutsloggen och klientvyn. Allt scopas genom sessionens byrå
// server-side; klientväljaren styr bara vyn. Attest-språk genomgående:
// "att attestera", "attesterad" — aldrig "proposals".

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

type Komplettering = {
  id: string;
  tenant_id: string;
  tenant_namn: string;
  proposal_id: string;
  typ: "missing_receipt" | "fraga";
  belopp_ore: number | null;
  beskrivning: string;
  status: "open" | "paminnd" | "klar";
  svar: string | null;
  skapad: string;
  senast_paminnd: string | null;
  proposal_summary: string;
};

type KlientKompletteringar = {
  tenant_id: string;
  tenant_namn: string;
  manad: { attest_vantar: number; kompletteringar_oppna: number; gron: boolean };
  rader: Komplettering[];
  utkast: { subject: string; body: string } | null;
};

type ChattInlagg = {
  roll: "konsult" | "agent";
  text: string;
  lagrum?: Lagrum[];
  konfidens?: number;
  saldo?: { konto: string; formaterat: string };
  motor?: string;
};

type Kundfraga = {
  id: string;
  tenant_id: string;
  tenant_namn: string;
  fraga: string;
  underlag_id: string | null;
  underlag_summary: string | null;
  status: "open" | "besvarad";
  svar: string | null;
  skapad: string;
  besvarad: string | null;
};

type KanalData = {
  app_aktiverad: boolean;
  anvandare: { id: string; email: string; namn: string; created_at: string }[];
  inbjudningar: { id: string; email: string; skapad: string; utgar: string; anvand: boolean }[];
  mejladress: string;
  avsandare: { id: string; email: string; created_at: string }[];
  karantan: {
    id: string;
    fran: string;
    amne: string | null;
    antal_bilagor: number;
    mottaget: string;
  }[];
};

// Varför-panelens underlag (WP40) — speglar ForhorsUnderlag i
// src/ytor/forhor.ts (serverns typ är sanningen).
type ForhorsUnderlag = {
  proposal: {
    id: string;
    summary: string;
    module: string;
    kind: string;
    status: string;
    confidence: number;
    motpart: string | null;
    affarshandelsedatum: string;
    created_at: string;
    flaggor: Flagga[];
    legal: Lagrum[];
    provenance: {
      model: string;
      mall: string | null;
      agent_runtime: string | null;
      injection_screened: boolean;
    };
  };
  policyutfall: {
    missade_villkor: string[];
    policy: {
      max_belopp_ore: number;
      min_confidence: number;
      kanda_motparter_endast: boolean;
      tillatna_kinds: string[];
    } | null;
  };
  paket: {
    id: string;
    displayName: string;
    version: string;
    regler: { id: string; beskrivning: string; lagrum?: string }[];
  }[];
  historik: {
    typ: "verifikation" | "forslag";
    datum: string;
    beskrivning: string;
    belopp_ore: number;
    konto: string | null;
    utfall: string;
    verifikationsnummer: number | null;
  }[];
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
  { id: "fragor", namn: "Frågor" },
  { id: "vanta", namn: "Väntar på kunden" },
  { id: "intag", namn: "Underlag in" },
  { id: "chatt", namn: "Chatt" },
  { id: "logg", namn: "Beslutslogg" },
  { id: "klient", namn: "Klient" },
] as const;
type FlikId = (typeof FLIKAR)[number]["id"];

// ---------------------------------------------------------------- attest

/** Ångra-fönstret: ett stagat beslut skickas när nästa fattas, när
 *  fönstret löper ut eller när vyn lämnas — U innan dess återställer. */
const ANGRA_FONSTER_MS = 6000;

// Varför-panelen (WP40): förhörets lager 1 — utfällbar sektion i
// detaljpanelen som visar det som redan finns om förslaget: agentens
// motivering + flaggor, aktiva branschpaketsregler (regel-id + namn),
// konfidens + policyutfall (omräknat mot gällande policy) och motpartens
// 3 senaste verifikat/förslag hos tenanten. Deterministisk läsning —
// ingen LLM-runda. V öppnar/stänger (tangenten hanteras i AttestSektion).
function VarforPanel({ rad }: { rad: KoRad }) {
  const [underlag, setUnderlag] = useState<ForhorsUnderlag | null>(null);
  const [fel, setFel] = useState(false);

  // Hämtas per förslag: radbyte med öppen panel laddar nya radens
  // underlag; ett sent svar för en lämnad rad kastas (aktiv-vakten).
  useEffect(() => {
    let aktiv = true;
    setUnderlag(null);
    setFel(false);
    hamta<ForhorsUnderlag>(
      `/api/byra/forhor?klient=${encodeURIComponent(rad.tenant_id)}` +
        `&proposal=${encodeURIComponent(rad.id)}`,
    ).then((u) => {
      if (!aktiv) return;
      if (u) setUnderlag(u);
      else setFel(true);
    });
    return () => {
      aktiv = false;
    };
  }, [rad.id, rad.tenant_id]);

  if (fel) {
    return (
      <div className="varfor-panel" role="region" aria-label="Varför-panelen">
        <p className="fel">
          Underlaget kunde inte hämtas just nu — förslaget och flaggorna ovan
          gäller fortfarande.
        </p>
      </div>
    );
  }
  if (!underlag) {
    return (
      <div className="varfor-panel" role="region" aria-label="Varför-panelen">
        <p className="laddar">hämtar underlaget …</p>
      </div>
    );
  }

  const u = underlag;
  const policy = u.policyutfall.policy;
  return (
    <div className="varfor-panel" role="region" aria-label="Varför-panelen">
      <div className="diff-rubrik">Agentens motivering</div>
      <p className="varfor-text">{u.proposal.summary}</p>
      {u.proposal.flaggor.length > 0 && (
        <ul className="varfor-regler">
          {u.proposal.flaggor.map((f) => (
            <li key={f.id}>
              <code className="varfor-regel-id">{f.id}</code> {f.text}
            </li>
          ))}
        </ul>
      )}
      {u.proposal.legal.length > 0 && (
        <ul className="lagrum-lista">
          {u.proposal.legal.map((l, i) => (
            <li key={i}>
              {l.lagrum} <span className="tyst">· {l.ruleset}</span>
              {l.note ? ` — ${l.note}` : ""}
            </li>
          ))}
        </ul>
      )}

      <div className="diff-rubrik">Aktiva branschpaketsregler</div>
      {u.paket.length === 0 ? (
        <p className="tyst varfor-text">
          Inga branschpaket aktiva — klientens bransch aktiverar inget paket.
        </p>
      ) : (
        u.paket.map((p) => (
          <div key={p.id} className="varfor-paket">
            <span className="varfor-paket-namn">
              {p.displayName} <span className="tyst">({p.id}@{p.version})</span>
            </span>
            <ul className="varfor-regler">
              {p.regler.map((r) => (
                <li key={r.id}>
                  <code className="varfor-regel-id">{r.id}</code> {r.beskrivning}
                  {r.lagrum && <span className="tyst"> — {r.lagrum}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      <div className="diff-rubrik">Konfidens och policyutfall</div>
      <div className="metarad" style={{ marginTop: 0 }}>
        <Chip>konfidens {Math.round(u.proposal.confidence * 100)} %</Chip>
        {policy && <Chip tal>er gräns {kr(policy.max_belopp_ore)} kr</Chip>}
        {policy && <Chip>minst {Math.round(policy.min_confidence * 100)} % konfidens</Chip>}
        {policy?.kanda_motparter_endast && <Chip>endast kända motparter</Chip>}
      </div>
      {u.policyutfall.missade_villkor.length === 0 ? (
        <p className="diff-ok">Inom er policy — beslutet är ändå ert.</p>
      ) : (
        <ul className="diff-lista">
          {u.policyutfall.missade_villkor.map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ul>
      )}

      <div className="diff-rubrik">Samma motpart senast</div>
      {u.proposal.motpart === null ? (
        <p className="tyst varfor-text">Förslaget saknar motpart — ingen historik att visa.</p>
      ) : u.historik.length === 0 ? (
        <p className="tyst varfor-text">
          Inga tidigare verifikat eller förslag från {u.proposal.motpart}.
        </p>
      ) : (
        <table className="rader">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Underlag</th>
              <th className="tal">Konto</th>
              <th className="tal">Belopp</th>
              <th>Utfall</th>
            </tr>
          </thead>
          <tbody>
            {u.historik.map((h, i) => (
              <tr key={i}>
                <td className="tal">{h.datum}</td>
                <td>
                  {h.beskrivning}
                  {h.verifikationsnummer !== null && (
                    <span className="tyst"> · V{h.verifikationsnummer}</span>
                  )}
                </td>
                <td className="tal">{h.konto ?? "—"}</td>
                <td className="tal">{h.belopp_ore > 0 ? `${kr(h.belopp_ore)} kr` : "—"}</td>
                <td>{h.utfall}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="varfor-provenans tyst">
        modell {u.proposal.provenance.model}
        {u.proposal.provenance.mall && <> · mall {u.proposal.provenance.mall}</>}
        {u.proposal.provenance.agent_runtime && <> · {u.proposal.provenance.agent_runtime}</>}
        {" · "}
        injection-screening: {u.proposal.provenance.injection_screened ? "ja" : "nej"}
      </p>
    </div>
  );
}

// WP26: radlista + detaljpanel i sidled (aldrig modal — kön förblir
// synlig och nästa förslag är redan laddat i klienten). Tangentbordet
// bär flödet: ↑↓ väljer, Enter fokuserar detaljen, A attesterar,
// X öppnar motiveringsfältet, U ångrar senaste innan det skickats,
// V fäller ut Varför-panelen (WP40).
// Själva maskinen är ren och testad (attest-tangentbord.ts).
function AttestSektion({
  ko,
  visaKlient,
  onBeslutad,
  fokusRad,
  onFokusKlar,
}: {
  ko: KoRad[];
  visaKlient: boolean;
  onBeslutad: () => Promise<void>;
  fokusRad: string | null;
  onFokusKlar: () => void;
}) {
  const [lage, setLage] = useState<AttestLage>(() => nyttLage(ko.map((k) => k.id)));
  const [fel, setFel] = useState("");
  const [bekraftelse, setBekraftelse] = useState("");
  const [motivering, setMotivering] = useState("");
  // "Fråga kunden" (WP33): konsultens fråga på det valda förslaget blir
  // en kompletteringsrad — svaret fästs vid förslaget i beslutsloggen.
  const [fragar, setFragar] = useState(false);
  const [fragaText, setFragaText] = useState("");
  const [fragaBekraftelse, setFragaBekraftelse] = useState("");
  // Varför-panelen (WP40): öppen-läget överlever radbyte — konsulten som
  // förhör kön rad för rad slipper trycka V för varje förslag.
  const [varforOppen, setVarforOppen] = useState(false);
  const detaljRef = useRef<HTMLDivElement>(null);
  const motiveringRef = useRef<HTMLInputElement>(null);

  // Radcache: en stagad rad har lämnat props-kön men behövs för
  // ångra-bannern (och för commit:ens tenant_id).
  const cacheRef = useRef(new Map<string, KoRad>());
  for (const k of ko) cacheRef.current.set(k.id, k);
  const rad = (id: string) => cacheRef.current.get(id);

  const lageRef = useRef(lage);
  lageRef.current = lage;

  const skicka = useCallback(
    async (id: string, beslut: AttestBeslut, reason?: string) => {
      const r = cacheRef.current.get(id);
      if (!r) return;
      try {
        const svar = await post<{
          status: string;
          verifikation?: { nummer: number; extern_ref: string } | null;
        }>("/api/beslut", { tenant_id: r.tenant_id, proposal_id: id, beslut, reason });
        setBekraftelse(
          beslut === "godkand"
            ? svar.verifikation
              ? `Attesterad — bokförd som verifikation ${svar.verifikation.nummer} (append-only, kvitterad: ${svar.verifikation.extern_ref}).`
              : "Attesterad — utan ledger-effekt (rådgivningssvar bokförs inte)."
            : "Avvisad — beslutet och motiveringen är loggade, inget bokfördes.",
        );
        await onBeslutad();
      } catch (e) {
        setFel(e instanceof Error ? e.message : String(e));
        // Resynka mot servern — raden är kvar som pending och ska synas.
        await onBeslutad();
      }
    },
    [onBeslutad],
  );

  // Effekterna verkställs UTANFÖR setState-uppdateraren (StrictMode
  // dubbelkör uppdaterare — en POST i den vore ett dubbelbeslut).
  const dispatch = useCallback(
    (h: AttestHandelse) => {
      const steg = attestMaskin(lageRef.current, h);
      lageRef.current = steg.lage;
      setLage(steg.lage);
      setFel("");
      for (const e of steg.effekter) {
        if (e.typ === "skicka") void skicka(e.id, e.beslut, e.motivering);
      }
    },
    [skicka],
  );

  // Färsk serverdata in i maskinen (stagad rad filtreras där). Körs på
  // ARRAY-identiteten, inte ett id-fingeravtryck: efter en misslyckad
  // POST kan servern svara med exakt samma lista, och då måste den
  // borttagna raden ändå tillbaka in i maskinen (granskningsfynd WP29).
  useEffect(() => {
    dispatch({ typ: "rader", rader: ko.map((k) => k.id) });
  }, [ko, dispatch]);

  // Radcachen rensas mot färsk kö — utan rensning växer den hela passet
  // och kan rendera inaktuella rader (granskningsfynd WP29). Den stagade
  // raden behålls: ångra-bannern behöver den tills beslutet skickats.
  useEffect(() => {
    const behall = new Set(ko.map((k) => k.id));
    const vantande = lageRef.current.vantande?.id;
    for (const id of cacheRef.current.keys()) {
      if (!behall.has(id) && id !== vantande) cacheRef.current.delete(id);
    }
  }, [ko]);

  // Ångra-fönstret: committa när tiden gått.
  const vantandeId = lage.vantande?.id ?? null;
  useEffect(() => {
    if (!vantandeId) return;
    const t = setTimeout(() => dispatch({ typ: "commit" }), ANGRA_FONSTER_MS);
    return () => clearTimeout(t);
  }, [vantandeId, dispatch]);

  // Lämnas vyn skickas ett väntande beslut direkt — ångra-fönstret är
  // bekvämlighet, aldrig en väg att tappa ett beslut. React-cleanupen
  // täcker flikbyte; pagehide täcker stängning/omladdning/navigering
  // (granskningsfynd WP29: unmount-effekter körs INTE vid tab-stängning).
  // keepalive-POST:en är fire-and-forget — går den fel ligger förslaget
  // kvar som pending hos servern och dyker upp igen vid nästa hämtning.
  const flushVantande = useCallback(() => {
    const v = lageRef.current.vantande;
    const r = v ? cacheRef.current.get(v.id) : undefined;
    if (!v || !r) return;
    lageRef.current = { ...lageRef.current, vantande: null };
    void fetch("/api/beslut", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        tenant_id: r.tenant_id,
        proposal_id: v.id,
        beslut: v.beslut,
        reason: v.motivering,
      }),
    });
  }, []);

  useEffect(() => {
    window.addEventListener("pagehide", flushVantande);
    return () => {
      window.removeEventListener("pagehide", flushVantande);
      flushVantande();
    };
  }, [flushVantande]);

  // Tangentbordet — globalt i attest-fliken; fält och dialoger äger
  // sina egna tangenter (target-vakten släpper igenom dem).
  useEffect(() => {
    function pa(e: KeyboardEvent) {
      const mal = e.target as HTMLElement | null;
      if (mal?.closest("input, textarea, select, [role=dialog]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        dispatch({ typ: "ner" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        dispatch({ typ: "upp" });
      } else if (e.key === "Enter") {
        // En fokuserad knapp/länk äger Enter — annars dör aktiveringen
        // för allt tangentbordsfokus på fliken (granskningsfynd WP29).
        if (mal?.closest("button, a, summary")) return;
        e.preventDefault();
        detaljRef.current?.focus();
      } else if (e.key === "Escape") {
        dispatch({ typ: "avbryt" });
      } else {
        // Beslutständer får aldrig autorepetera — ett nedhållet A ska
        // inte hagla attester genom kön (granskningsfynd WP29).
        if (e.repeat) return;
        const k = e.key.toLowerCase();
        if (k === "a") {
          e.preventDefault();
          dispatch({ typ: "attestera" });
        } else if (k === "x") {
          e.preventDefault();
          dispatch({ typ: "avvisa-oppna" });
        } else if (k === "u") {
          e.preventDefault();
          dispatch({ typ: "angra" });
        } else if (k === "v") {
          e.preventDefault();
          setVarforOppen((o) => !o);
        }
      }
    }
    window.addEventListener("keydown", pa);
    return () => window.removeEventListener("keydown", pa);
  }, [dispatch]);

  // X öppnar motiveringsfältet — töm och fokusera.
  useEffect(() => {
    if (lage.avvisar) {
      setMotivering("");
      motiveringRef.current?.focus();
    }
  }, [lage.avvisar]);

  // Cmd+K:s motpartssök landar här: välj raden och visa detaljen.
  useEffect(() => {
    if (!fokusRad) return;
    const i = lageRef.current.rader.indexOf(fokusRad);
    if (i >= 0) dispatch({ typ: "valj", index: i });
    onFokusKlar();
  }, [fokusRad, dispatch, onFokusKlar]);

  const valdId = lage.index >= 0 ? lage.rader[lage.index] : null;
  const vald = valdId ? rad(valdId) : null;
  const vantandeRad = lage.vantande ? rad(lage.vantande.id) : null;

  // Radbyte nollställer frågeflödet — frågan hör till ett förslag.
  useEffect(() => {
    setFragar(false);
    setFragaText("");
    setFragaBekraftelse("");
  }, [valdId]);

  async function skickaFraga() {
    if (!vald || !fragaText.trim()) return;
    setFel("");
    try {
      await post("/api/byra/kompletteringar", {
        handling: "fraga",
        tenant_id: vald.tenant_id,
        proposal_id: vald.id,
        fraga: fragaText,
      });
      setFragar(false);
      setFragaText("");
      setFragaBekraftelse(
        "Frågan ligger i kompletteringskön — svaret fästs vid förslaget när det registreras.",
      );
      await onBeslutad();
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="steg">
      <div className="steg-rubrik">
        <h2 className="steg-titel">Att attestera</h2>
        <span className="steg-not">
          {lage.rader.length === 0 ? "inget väntar" : `${lage.rader.length} väntar`} ·
          avvikelsen mot er policy räknas om vid varje hämtning
        </span>
      </div>

      {lage.vantande && vantandeRad && (
        <div className="angra-rad" role="status">
          <span>
            {lage.vantande.beslut === "godkand" ? "Attesteras" : "Avvisas"}:{" "}
            {vantandeRad.summary}
          </span>
          <button onClick={() => dispatch({ typ: "angra" })}>Ångra (U)</button>
          <span className="tyst">skickas om några sekunder eller vid nästa beslut</span>
        </div>
      )}

      {bekraftelse && !lage.vantande && (
        <div className="bokford" role="status" style={{ marginBottom: "var(--sp-3)" }}>
          {bekraftelse}
        </div>
      )}

      {lage.rader.length === 0 && !lage.vantande ? (
        <TomtLage>
          Inget att attestera just nu — nya underlag och frågor dyker upp här när de
          faller utanför er policy.
        </TomtLage>
      ) : (
        <div className="attest-layout">
          <ul className="ko-lista" aria-label="Attestkön">
            {lage.rader.map((id, i) => {
              const k = rad(id);
              if (!k) return null;
              return (
                <li key={id}>
                  <button
                    className="ko-rad"
                    aria-current={i === lage.index ? "true" : undefined}
                    data-vald={i === lage.index}
                    onClick={() => {
                      dispatch({ typ: "valj", index: i });
                      if (window.innerWidth < 900) {
                        detaljRef.current?.scrollIntoView({ block: "nearest" });
                      }
                    }}
                  >
                    <span className="ko-rad-summary">{k.summary}</span>
                    <span className="ko-rad-meta">
                      {visaKlient && <Chip>{k.tenant_namn}</Chip>}
                      <Chip>{Math.round(k.confidence * 100)} %</Chip>
                      {k.belopp_ore > 0 && <Chip tal>{kr(k.belopp_ore)} kr</Chip>}
                      {k.missade_villkor.length > 0 && (
                        <Chip varning>
                          {k.missade_villkor.length} utanför policy
                        </Chip>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div
            className="ko-detalj"
            ref={detaljRef}
            tabIndex={-1}
            aria-label="Valt förslag"
          >
            {!vald ? (
              <TomtLage>Välj en rad i kön — ↑↓ på tangentbordet räcker.</TomtLage>
            ) : (
              <>
                <div className="ko-huvud">
                  <span className="ko-summary">{vald.summary}</span>
                  <span className="tyst tid">{tid(vald.created_at)}</span>
                </div>

                <div className="metarad">
                  {visaKlient && <Chip>{vald.tenant_namn}</Chip>}
                  <Chip>{vald.module}</Chip>
                  <Chip>konfidens {Math.round(vald.confidence * 100)} %</Chip>
                  <Chip tal>hash {vald.hash.slice(0, 12)}…</Chip>
                  {vald.belopp_ore > 0 && <Chip tal>{kr(vald.belopp_ore)} kr</Chip>}
                  {vald.motpart && <Chip>{vald.motpart}</Chip>}
                </div>

                {vald.legal.length > 0 && (
                  <ul className="lagrum-lista">
                    {vald.legal.map((l, i) => (
                      <li key={i}>
                        {l.lagrum} <span className="tyst">· {l.ruleset}</span>
                        {l.note ? ` — ${l.note}` : ""}
                      </li>
                    ))}
                  </ul>
                )}

                {vald.flaggor.map((f) => (
                  <div key={f.id} className={`flagga ${f.niva === "info" ? "info" : ""}`}>
                    {f.text}
                  </div>
                ))}

                <div className="diff-rubrik">Varför den väntar på er</div>
                {vald.missade_villkor.length === 0 ? (
                  <p className="diff-ok">
                    Uppfyller numera er policy — väntar ändå på ert beslut.
                  </p>
                ) : (
                  <div className="metarad" style={{ marginTop: 0 }}>
                    {vald.missade_villkor.map((v, i) => (
                      <Chip key={i} varning>
                        {v}
                      </Chip>
                    ))}
                  </div>
                )}

                <div className="varfor">
                  <button
                    className="varfor-knapp"
                    aria-expanded={varforOppen}
                    onClick={() => setVarforOppen((o) => !o)}
                  >
                    {varforOppen ? "Dölj varför (V)" : "Varför? (V)"}
                  </button>
                  {varforOppen && <VarforPanel rad={vald} />}
                </div>

                <div style={{ marginTop: "var(--sp-3)" }}>
                  {fragar ? (
                    <div className="avvisa-rad">
                      <input
                        type="text"
                        value={fragaText}
                        onChange={(e) => setFragaText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && fragaText.trim()) {
                            e.preventDefault();
                            void skickaFraga();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            setFragar(false);
                          }
                        }}
                        placeholder="Fråga till kunden om detta underlag …"
                        aria-label="Fråga till kunden"
                        autoFocus
                      />
                      <button onClick={() => void skickaFraga()} disabled={!fragaText.trim()}>
                        Lägg i kompletteringskön
                      </button>
                      <button onClick={() => setFragar(false)}>Avbryt</button>
                    </div>
                  ) : (
                    <button onClick={() => setFragar(true)}>Fråga kunden</button>
                  )}
                  {fragaBekraftelse && !fragar && (
                    <span className="sparat" style={{ marginLeft: "var(--sp-2)" }}>
                      {fragaBekraftelse}
                    </span>
                  )}
                </div>

                {lage.avvisar ? (
                  <div className="avvisa-rad">
                    <input
                      ref={motiveringRef}
                      type="text"
                      value={motivering}
                      onChange={(e) => setMotivering(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          dispatch({ typ: "avvisa-skicka", motivering });
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          dispatch({ typ: "avbryt" });
                        }
                      }}
                      placeholder="Motivering (krävs för avvisning)"
                      aria-label="Motivering för avvisning"
                    />
                    <button
                      onClick={() => dispatch({ typ: "avvisa-skicka", motivering })}
                      disabled={!motivering.trim()}
                    >
                      Skicka avvisning
                    </button>
                    <button onClick={() => dispatch({ typ: "avbryt" })}>Avbryt</button>
                  </div>
                ) : (
                  <div className="beslutsrad">
                    <button className="godkann" onClick={() => dispatch({ typ: "attestera" })}>
                      Attestera
                    </button>
                    <button onClick={() => dispatch({ typ: "avvisa-oppna" })}>Avvisa</button>
                    <span className="tyst" style={{ maxWidth: 380 }}>
                      Attesten binds till förslagets hash och din identitet — inget når
                      huvudboken utan den (ansvarsprincipen).
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <p className="kortkommandon tyst" aria-hidden="true">
        ↑↓ välj · Enter detalj · A attestera · X avvisa · U ångra · V varför · ⌘K kommandon
      </p>

      {fel && <p className="fel">{fel}</p>}
    </section>
  );
}

// --------------------------------------------------- väntar på kunden

/** Underlagsjakten (WP33): kompletteringskön per klient — saknade kvitton
 *  och frågor till kunden, med ålder, belopp, påminnelse (mejlas via
 *  mejladaptern, WP23) och svarsregistrering. Månadsgrönt v0: grön chip
 *  när både attestkön och kompletteringskön är tomma. */
function VantaSektion({
  data,
  onForandring,
}: {
  data: KlientKompletteringar[];
  onForandring: () => Promise<void>;
}) {
  const [fel, setFel] = useState("");
  const [svarFor, setSvarFor] = useState<string | null>(null);
  const [svarText, setSvarText] = useState("");
  const [paminner, setPaminner] = useState<string | null>(null);
  const [paminnelseBesked, setPaminnelseBesked] = useState("");

  const manad = new Date().toLocaleString("sv-SE", { month: "long" });

  const alderDagar = (iso: string) =>
    Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

  /** Påminn per klient (WP23, ersätter mailto): EN POST — servern mejlar
   *  det färdiga utkastet via mejladaptern till klientbolagets
   *  klientanvändare och markerar först därefter alla öppna rader
   *  påminda. Saknas klientanvändare svarar servern med tydligt fel och
   *  ingenting markeras. */
  async function paminn(klient: KlientKompletteringar) {
    if (!klient.utkast) return;
    setFel("");
    setPaminnelseBesked("");
    setPaminner(klient.tenant_id);
    try {
      const svar = await post<{ antal: number; till: string[] }>(
        "/api/byra/kompletteringar",
        { handling: "paminn", tenant_id: klient.tenant_id },
      );
      setPaminnelseBesked(
        `Påminnelse mejlad till ${svar.till.join(", ")} — ${svar.antal} ` +
          `${svar.antal === 1 ? "rad" : "rader"} markerade som påminda.`,
      );
      await onForandring();
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    } finally {
      setPaminner(null);
    }
  }

  async function skickaSvar(rad: Komplettering) {
    if (!svarText.trim()) return;
    setFel("");
    try {
      await post("/api/byra/kompletteringar", {
        handling: "svar",
        tenant_id: rad.tenant_id,
        komplettering_id: rad.id,
        svar: svarText,
      });
      setSvarFor(null);
      setSvarText("");
      await onForandring();
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    }
  }

  const tomt = data.every((k) => k.rader.length === 0);

  return (
    <section className="steg">
      <div className="steg-rubrik">
        <h2 className="steg-titel">Väntar på kunden</h2>
        <span className="steg-not">
          saknade kvitton och frågor — påminnelsen mejlas färdigskriven till kunden,
          svaret fästs vid förslaget i beslutsunderlaget
        </span>
      </div>

      {paminnelseBesked && (
        <div className="bokford" role="status" style={{ marginBottom: "var(--sp-3)" }}>
          {paminnelseBesked}
        </div>
      )}

      {tomt ? (
        <TomtLage>
          Inget väntar på någon kund — flaggade underlag och frågor lägger sig här av
          sig själva.
        </TomtLage>
      ) : (
        data.map((klient) => (
          <div key={klient.tenant_id} className="verifikation">
            <div className="huvud">
              <span className="beskr">{klient.tenant_namn}</span>
              {klient.manad.gron ? (
                <Chip>{manad}: grön</Chip>
              ) : (
                <Chip varning>
                  {manad}: {klient.manad.attest_vantar} att attestera ·{" "}
                  {klient.manad.kompletteringar_oppna} hos kunden
                </Chip>
              )}
              <span className="hoger">
                {klient.utkast && (
                  <button
                    onClick={() => void paminn(klient)}
                    disabled={paminner === klient.tenant_id}
                  >
                    {paminner === klient.tenant_id ? "Mejlar …" : "Påminn (mejlas)"}
                  </button>
                )}
              </span>
            </div>

            {klient.rader.length === 0 ? (
              <p className="tyst" style={{ margin: "var(--sp-2) 0" }}>
                Inget väntar hos {klient.tenant_namn}.
              </p>
            ) : (
              <table className="rader">
                <thead>
                  <tr>
                    <th>Typ</th>
                    <th>Gäller</th>
                    <th className="tal">Belopp</th>
                    <th className="tal">Ålder</th>
                    <th>Status</th>
                    <th>Svar</th>
                  </tr>
                </thead>
                <tbody>
                  {klient.rader.map((rad) => (
                    <tr key={rad.id}>
                      <td>
                        {rad.typ === "missing_receipt" ? (
                          <Chip varning>kvitto saknas</Chip>
                        ) : (
                          <Chip>fråga</Chip>
                        )}
                      </td>
                      <td>
                        {rad.proposal_summary}
                        {rad.typ === "fraga" && (
                          <div className="tyst">”{rad.beskrivning}”</div>
                        )}
                      </td>
                      <td className="tal">
                        {rad.belopp_ore !== null ? `${kr(rad.belopp_ore)} kr` : "—"}
                      </td>
                      <td className="tal">{alderDagar(rad.skapad)} d</td>
                      <td>
                        {rad.status === "klar" ? (
                          "klar"
                        ) : rad.status === "paminnd" ? (
                          <>påmind {rad.senast_paminnd ? tid(rad.senast_paminnd) : ""}</>
                        ) : (
                          "öppen"
                        )}
                      </td>
                      <td>
                        {rad.status === "klar" ? (
                          <span>{rad.svar}</span>
                        ) : svarFor === rad.id ? (
                          <span className="avvisa-rad" style={{ margin: 0 }}>
                            <input
                              type="text"
                              value={svarText}
                              onChange={(e) => setSvarText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && svarText.trim()) {
                                  e.preventDefault();
                                  void skickaSvar(rad);
                                } else if (e.key === "Escape") {
                                  setSvarFor(null);
                                }
                              }}
                              placeholder="Kundens svar / underlag inkommet …"
                              aria-label="Registrera svar"
                              autoFocus
                            />
                            <button
                              onClick={() => void skickaSvar(rad)}
                              disabled={!svarText.trim()}
                            >
                              Registrera
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              setSvarFor(rad.id);
                              setSvarText("");
                            }}
                          >
                            Registrera svar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))
      )}

      {fel && <p className="fel">{fel}</p>}
    </section>
  );
}

// ----------------------------------------------------------------- frågor

/** Fliken "Frågor" (WP24): kundassistentens eskalerade ärenden — det
 *  kunden frågade i appen och som ALDRIG besvaras där (rådgivning är
 *  byråns roll och relation). Underlaget står länkat; konsultens svar
 *  syns i kundens app vid nästa poll. */
function FragorSektion({
  fragor,
  visaKlient,
  onForandring,
}: {
  fragor: Kundfraga[];
  visaKlient: boolean;
  onForandring: () => Promise<void>;
}) {
  const [svarFor, setSvarFor] = useState<string | null>(null);
  const [svarText, setSvarText] = useState("");
  const [fel, setFel] = useState("");

  async function besvara(f: Kundfraga) {
    if (!svarText.trim()) return;
    setFel("");
    try {
      await post("/api/byra/fragor", {
        tenant_id: f.tenant_id,
        fraga_id: f.id,
        svar: svarText,
      });
      setSvarFor(null);
      setSvarText("");
      await onForandring();
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="steg">
      <div className="steg-rubrik">
        <h2 className="steg-titel">Frågor från kunden</h2>
        <span className="steg-not">
          kundassistenten svarar aldrig med råd — rådfrågorna hamnar här, med
          underlaget länkat, och ditt svar syns i kundens app
        </span>
      </div>

      {fragor.length === 0 ? (
        <TomtLage>
          Inga kundfrågor just nu — när kunden ställer en rådgivningsfråga i appen
          lägger den sig här.
        </TomtLage>
      ) : (
        <table className="rader">
          <thead>
            <tr>
              {visaKlient && <th>Klient</th>}
              <th>Fråga</th>
              <th className="tal">Ställd</th>
              <th>Svar</th>
            </tr>
          </thead>
          <tbody>
            {fragor.map((f) => (
              <tr key={f.id}>
                {visaKlient && <td>{f.tenant_namn}</td>}
                <td>
                  {f.fraga}
                  {f.underlag_summary && (
                    <div className="tyst">Gäller underlaget: {f.underlag_summary}</div>
                  )}
                </td>
                <td className="tal">{tid(f.skapad)}</td>
                <td>
                  {f.status === "besvarad" ? (
                    <span>{f.svar}</span>
                  ) : svarFor === f.id ? (
                    <span className="avvisa-rad" style={{ margin: 0 }}>
                      <input
                        type="text"
                        value={svarText}
                        onChange={(e) => setSvarText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && svarText.trim()) {
                            e.preventDefault();
                            void besvara(f);
                          } else if (e.key === "Escape") {
                            setSvarFor(null);
                          }
                        }}
                        placeholder="Ditt svar till kunden …"
                        aria-label="Svar till kunden"
                        autoFocus
                      />
                      <button onClick={() => void besvara(f)} disabled={!svarText.trim()}>
                        Svara
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        setSvarFor(f.id);
                        setSvarText("");
                      }}
                    >
                      Besvara
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

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
        <TomtLage>Välj en klient i väljaren uppe till höger för att ta in underlag.</TomtLage>
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
                <Chip key={skill}>
                  {skill}@{version}
                </Chip>
              ))}
              <Chip tal>hash {forslag.hash.slice(0, 12)}…</Chip>
              <Chip>konfidens {Math.round(forslag.confidence * 100)} %</Chip>
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
        <TomtLage>
          Välj en klient — saldofrågor besvaras ur den valda klientens huvudbok.
        </TomtLage>
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
                  <Chip tal>
                    saldo {m.saldo.konto}: {m.saldo.formaterat}
                  </Chip>
                )}
                {m.lagrum?.map((l, j) => (
                  <Chip key={j}>{l.lagrum}</Chip>
                ))}
                {m.konfidens !== undefined && (
                  <Chip>konfidens {Math.round(m.konfidens * 100)} %</Chip>
                )}
                {m.motor === "fallback" && <Chip>deterministisk fallback</Chip>}
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
        <TomtLage>Inga beslut ännu.</TomtLage>
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
                        <Chip>policybeslut</Chip>{" "}
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
                    {l.agent_runtime && <Chip>{l.agent_runtime}</Chip>}
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

/** Klientens kanaler (WP24): bjud in klientanvändare (WP20), se appens
 *  status, mejladressen in, registrerade avsändare och karantänen.
 *  Avsändarna hanterar kunden själv i appen — byrån läser. */
function KanalSektion({ klient }: { klient: Klient }) {
  const [kanal, setKanal] = useState<KanalData | null>(null);
  const [email, setEmail] = useState("");
  const [lank, setLank] = useState("");
  const [bjuder, setBjuder] = useState(false);
  const [fel, setFel] = useState("");

  const ladda = useCallback(async () => {
    const data = await hamta<KanalData>(`/api/byra/klient/kanal?klient=${klient.id}`);
    if (data) setKanal(data);
  }, [klient.id]);

  useEffect(() => {
    setLank("");
    setEmail("");
    setFel("");
    ladda();
  }, [ladda]);

  async function bjudIn() {
    if (!email.trim()) return;
    setFel("");
    setBjuder(true);
    try {
      const svar = await post<{ lank: string; utgar: string }>("/api/byra/klient/inbjudan", {
        tenant_id: klient.id,
        email,
      });
      setLank(`${window.location.origin}${svar.lank}`);
      setEmail("");
      await ladda();
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    } finally {
      setBjuder(false);
    }
  }

  return (
    <section className="steg">
      <div className="steg-rubrik">
        <h2 className="steg-titel">Kundkanaler — {klient.namn}</h2>
        <span className="steg-not">
          appen och mejladressen är kundens vägar in — allt landar i samma flöde
        </span>
        {kanal &&
          (kanal.app_aktiverad ? (
            <Chip>app aktiverad</Chip>
          ) : (
            <Chip varning>app ej aktiverad</Chip>
          ))}
      </div>

      {!kanal ? (
        <p className="laddar">laddar …</p>
      ) : (
        <>
          <h3 className="policy-namn">Klientanvändare</h3>
          {kanal.anvandare.length === 0 && kanal.inbjudningar.every((i) => i.anvand) && (
            <p className="tyst" style={{ margin: "var(--sp-2) 0" }}>
              Ingen klientanvändare ännu — bjud in nedan så kan kunden fota kvitton i
              appen och ta emot påminnelser.
            </p>
          )}
          {kanal.anvandare.length > 0 && (
            <table className="rader">
              <thead>
                <tr>
                  <th>Namn</th>
                  <th>E-post</th>
                  <th className="tal">Sedan</th>
                </tr>
              </thead>
              <tbody>
                {kanal.anvandare.map((a) => (
                  <tr key={a.id}>
                    <td>{a.namn}</td>
                    <td>{a.email}</td>
                    <td className="tal">{tid(a.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {kanal.inbjudningar.filter((i) => !i.anvand).length > 0 && (
            <p className="tyst" style={{ margin: "var(--sp-2) 0" }}>
              Väntande inbjudningar:{" "}
              {kanal.inbjudningar
                .filter((i) => !i.anvand)
                .map((i) => `${i.email} (t.o.m. ${tid(i.utgar)})`)
                .join(", ")}
            </p>
          )}
          <div className="avvisa-rad" style={{ marginTop: "var(--sp-2)" }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="kundens e-postadress"
              aria-label="E-post för klientinbjudan"
              onKeyDown={(e) => {
                if (e.key === "Enter" && email.trim()) {
                  e.preventDefault();
                  void bjudIn();
                }
              }}
            />
            <button onClick={() => void bjudIn()} disabled={bjuder || !email.trim()}>
              {bjuder ? "Skapar …" : "Bjud in till appen"}
            </button>
          </div>
          {lank && (
            <div className="bokford" style={{ marginTop: "var(--sp-2)" }}>
              Inbjudningslänk skapad — kopiera och skicka till kunden (visas bara nu):
              <input
                type="text"
                readOnly
                value={lank}
                aria-label="Inbjudningslänk"
                style={{ width: "100%", marginTop: "var(--sp-1)", fontSize: 16 }}
                onFocus={(e) => e.target.select()}
              />
            </div>
          )}

          <h3 className="policy-namn" style={{ marginTop: "var(--sp-4)" }}>
            Mejl in
          </h3>
          <p style={{ margin: "0 0 var(--sp-2)" }}>
            <Chip tal>{kanal.mejladress}</Chip>
          </p>
          {kanal.avsandare.length === 0 ? (
            <p className="tyst">
              Inga registrerade avsändare — kunden lägger till sina adresser i appen
              under Skicka in.
            </p>
          ) : (
            <p className="tyst">
              Registrerade avsändare: {kanal.avsandare.map((a) => a.email).join(", ")}
            </p>
          )}

          {kanal.karantan.length > 0 && (
            <>
              <h3 className="policy-namn" style={{ marginTop: "var(--sp-4)" }}>
                Karantän
              </h3>
              <p className="tyst" style={{ margin: "0 0 var(--sp-2)" }}>
                Mejl från oregistrerade avsändare — innehållet släpps aldrig in; be
                kunden registrera adressen i appen och skicka om.
              </p>
              <table className="rader">
                <thead>
                  <tr>
                    <th>Avsändare</th>
                    <th>Ämne</th>
                    <th className="tal">Bilagor</th>
                    <th className="tal">Mottaget</th>
                  </tr>
                </thead>
                <tbody>
                  {kanal.karantan.map((k) => (
                    <tr key={k.id}>
                      <td>{k.fran}</td>
                      <td>{k.amne ?? "—"}</td>
                      <td className="tal">{k.antal_bilagor}</td>
                      <td className="tal">{tid(k.mottaget)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}

      {fel && <p className="fel">{fel}</p>}
    </section>
  );
}

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
        <TomtLage>Välj en klient i väljaren uppe till höger.</TomtLage>
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
      {/* Kundkanaler (WP24): inbjudan, appen, mejlet, karantänen. */}
      <KanalSektion klient={klient} />

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
          <TomtLage>Inga agenter är igång för {klient.namn}.</TomtLage>
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
                    <StatusPunkt status={a.status as AgentStatus} />
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
          <TomtLage>
            Inga verifikationer ännu för {klient.namn} — ta in det första underlaget
            under fliken Underlag in, eller vänta in att något attesteras.
          </TomtLage>
        )}
        {verifikationer.map((v) => (
          <div key={v.id} className="verifikation">
            <div className="huvud">
              <span className="nr">V{v.nummer}</span>
              <span className="beskr">{v.beskrivning}</span>
              <span className="tyst">{v.affarshandelsedatum.slice(0, 10)}</span>
              {v.rattar_verifikation && <span className="rattelse-tag">rättelsepost</span>}
              {v.extern_ref && <Chip tal>{v.extern_ref}</Chip>}
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
  const [komp, setKomp] = useState<KlientKompletteringar[]>([]);
  const [fragor, setFragor] = useState<Kundfraga[]>([]);
  const [palettOppen, setPalettOppen] = useState(false);
  const [fokusRad, setFokusRad] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/byra/klienter").then(async (r) => {
      if (!r.ok) {
        router.push("/login?next=/byra");
        return;
      }
      setSession((await r.json()) as Sessionsvy);
    });
  }, [router]);

  // Sekvensvakter: snabba attester i rad startar överlappande hämtningar,
  // och ett ÄLDRE svar som landar sist får inte skriva över ett nyare —
  // en redan beslutad rad skulle då blinka tillbaka (granskningsfynd WP29).
  const koSeq = useRef(0);
  const loggSeq = useRef(0);
  const kompSeq = useRef(0);
  const fragorSeq = useRef(0);

  const laddaKo = useCallback(async (v: string) => {
    const seq = ++koSeq.current;
    const rader = await hamta<KoRad[]>(`/api/byra/ko?klient=${v}`);
    if (rader && seq === koSeq.current) setKo(rader);
  }, []);

  const laddaLogg = useCallback(async (v: string) => {
    const seq = ++loggSeq.current;
    const rader = await hamta<LoggRad[]>(`/api/byra/logg?klient=${v}&limit=50`);
    if (rader && seq === loggSeq.current) setLogg(rader);
  }, []);

  const laddaKomp = useCallback(async (v: string) => {
    const seq = ++kompSeq.current;
    const rader = await hamta<KlientKompletteringar[]>(`/api/byra/kompletteringar?klient=${v}`);
    if (rader && seq === kompSeq.current) setKomp(rader);
  }, []);

  const laddaFragor = useCallback(async (v: string) => {
    const seq = ++fragorSeq.current;
    const rader = await hamta<Kundfraga[]>(`/api/byra/fragor?klient=${v}`);
    if (rader && seq === fragorSeq.current) setFragor(rader);
  }, []);

  useEffect(() => {
    if (!session) return;
    laddaKo(val);
    laddaLogg(val);
    laddaKomp(val);
    laddaFragor(val);
  }, [session, val, laddaKo, laddaLogg, laddaKomp, laddaFragor]);

  const uppdatera = useCallback(async () => {
    await Promise.all([laddaKo(val), laddaLogg(val), laddaKomp(val), laddaFragor(val)]);
  }, [val, laddaKo, laddaLogg, laddaKomp, laddaFragor]);

  // Cmd+K öppnar paletten (WP26). Kommandokatalogen byggs av den delade
  // byggaren — konsultrollen ger ALDRIG operatörskommandon (WP29-regeln).
  useKommandoGenvag(useCallback(() => setPalettOppen((o) => !o), []));

  const kommandon = useMemo(
    () =>
      byggKommandon({
        roll: "konsult",
        klienter: session?.klienter ?? [],
        motparter: [
          ...new Set(ko.map((k) => k.motpart).filter((m): m is string => Boolean(m))),
        ],
      }),
    [session, ko],
  );

  const korKommando = useCallback(
    (k: Kommando) => {
      const skilj = k.id.indexOf(":");
      const typ = k.id.slice(0, skilj);
      const varde = k.id.slice(skilj + 1);
      if (typ === "flik") {
        setFlik(varde as FlikId);
      } else if (typ === "klient") {
        setVal(varde);
      } else if (typ === "motpart") {
        const traff = ko.find((r) => r.motpart === varde);
        if (traff) {
          setFlik("attest");
          setFokusRad(traff.id);
        }
      }
    },
    [ko],
  );

  const fokusKlar = useCallback(() => setFokusRad(null), []);

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
  const oppnaKomp = komp.reduce(
    (s, k) => s + k.rader.filter((r) => r.status !== "klar").length,
    0,
  );
  const oppnaFragor = fragor.filter((f) => f.status === "open").length;

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
          <button
            onClick={() => setPalettOppen(true)}
            aria-label="Öppna kommandopaletten (Cmd+K)"
            title="Kommandopaletten (Cmd+K)"
          >
            ⌘K
          </button>
          <button onClick={loggaUt}>Logga ut</button>
          <select
            value={val}
            onChange={(e) => setVal(e.target.value)}
            aria-label="Välj klient"
          >
            <option value="alla">alla klienter</option>
            {session.klienter.map((k) => (
              <option key={k.id} value={k.id}>
                {k.namn} ({k.mall})
              </option>
            ))}
          </select>
        </div>
      </div>

      <KommandoPalett
        oppen={palettOppen}
        kommandon={kommandon}
        onVal={korKommando}
        onStang={() => setPalettOppen(false)}
      />

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
            {f.id === "fragor" && oppnaFragor > 0 && (
              <span className="antal">{oppnaFragor}</span>
            )}
            {f.id === "vanta" && oppnaKomp > 0 && <span className="antal">{oppnaKomp}</span>}
          </button>
        ))}
      </nav>

      {flik === "attest" && (
        <AttestSektion
          ko={ko}
          visaKlient={val === "alla"}
          onBeslutad={uppdatera}
          fokusRad={fokusRad}
          onFokusKlar={fokusKlar}
        />
      )}
      {flik === "fragor" && (
        <FragorSektion fragor={fragor} visaKlient={val === "alla"} onForandring={uppdatera} />
      )}
      {flik === "vanta" && <VantaSektion data={komp} onForandring={uppdatera} />}
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
