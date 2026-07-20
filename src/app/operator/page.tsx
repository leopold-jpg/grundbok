"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { plexMono } from "../_publik/fonter";
import { byggKommandon, type Kommando } from "@/ytor/komponenter/kommandon";
import { KommandoPalett, useKommandoGenvag } from "@/ytor/komponenter/KommandoPalett";
import { Chip } from "@/ytor/komponenter/Chip";
import { StatusPunkt, type AgentStatus } from "@/ytor/komponenter/StatusPunkt";
import { TomtLage } from "@/ytor/komponenter/TomtLage";
import { Nyckelkort } from "@/ytor/komponenter/Nyckelkort";
import { Sparkline } from "@/ytor/komponenter/Sparkline";
import "../../ytor/komponenter/komponenter.css";
import "./operator.css";

// Operatörskonsolen (WP14, agentfabriken i WP27) — grundarens vy.
// Tre flikar (poleringspasset): Provisionera är det vanligaste jobbet
// och därmed första flik och startläge; Flotta bär översikten byrå →
// klientbolag → agenter plus hälsan; Autonomiförval bär policyförvalen.
// Provisionering är ETT flöde i tre steg (klient → funktionsroll →
// namn → nyckel EN gång); agentdetaljen bär livslinje, policy-läge,
// nyckelrotation och tenantens driftläge. Regeln som allt lyder under:
// operatören ser AGGREGAT, aldrig kvitton, belopp eller förslags-innehåll.

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

type PolicyMall = {
  id: string;
  namn: string;
  module: string;
  max_belopp_ore: number;
  min_confidence: number;
  kanda_motparter_endast: boolean;
  tillatna_kinds: string[];
};

type Halsa = {
  ko_djup: number;
  senaste_korning: string | null;
  omforsok_24h: number;
  aldsta_vantande: string | null;
  per_modul: { module: string; ko_djup: number; omforsok_24h: number }[];
  intag_per_vecka: { vecka: string; kalla: string; antal: number }[];
};

// Speglar FlottRad/AgentDetalj i src/ytor/operator.ts: aggregat och
// driftmetadata, aldrig innehåll.
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
  branschpaket: string[];
  status: AgentStatus;
  forslag_7d: number;
  auto_7d: number;
  rejected_7d: number;
  corrected_7d: number;
  andel_auto: number | null;
  andel_korrigerade: number | null;
  senaste_aktivitet: string | null;
  varningar: FlottVarning[];
  forslag_dagar: number[];
};

type LivslinjeHandelse = "skapad" | "pausad" | "aterupptagen" | "avslutad";

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
  livslinje: { tid: string; handelse: LivslinjeHandelse }[];
  tenant_drift: { ko_djup: number; senaste_korning: string | null };
};

/** Katalogmetadata från /api/operator/agentmallar — aldrig registret
 *  självt i klienten: systemPrompt/regler ska inte in i en publik bundle.
 *  Aktiveringskartan låter steg 2 VISA vilka paket klientens bransch
 *  aktiverar — branschen väljs aldrig manuellt (ADR-0005). */
type Agentkatalog = {
  mallar: {
    id: string;
    displayName: string;
    version: string;
    branschpaket: string[];
    /** Serverderiverat av samma aktivaBranschpaket som driften kör —
     *  klienten visar, den härleder aldrig själv (granskningsfynd WP29). */
    aktiva_per_tenantmall: Record<string, string[]>;
  }[];
  paket: Record<string, { displayName: string; version: string }>;
  tenantmall_till_paket: Record<string, string[]>;
};

const VARNINGSTEXT: Record<FlottVarning, string> = {
  inaktiv_7d: "ingen aktivitet 7 d",
  hog_korrigeringsandel: "hög korrigeringsandel",
  versionsdrift: "versionsdrift",
};

const LIVSTEXT: Record<LivslinjeHandelse, string> = {
  skapad: "skapad",
  pausad: "pausad",
  aterupptagen: "återupptagen",
  avslutad: "avslutad",
};

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)} %`);

/** Filtervärde för mall-lösa agenter — kolliderar aldrig med ett mall-id. */
const UTAN_MALL = "__utan_mall__";

/** Testagenter känns igen på namnet (*-dev eller e2e-*): de chippas
 *  grått och döljs som förval i flottan — driften ska visa kunder,
 *  inte utvecklingsbrus. */
const arDevAgent = (namn: string) => namn.endsWith("-dev") || namn.startsWith("e2e-");

/** Rollkolumnen efter ADR-0005: funktionsroll + aktiva branschpaket som
 *  chips ("bokforing +restaurang") — aldrig versionssträngar (versions-
 *  drift bär sin egen varningschip i felkolumnen). Mall-lösa modul-
 *  agenter från före mallkatalogen visas som "roll (äldre)". */
function RollEtikett({
  r,
}: {
  r: Pick<FlottRad, "template_id" | "module" | "branschpaket">;
}) {
  if (!r.template_id) {
    return (
      <span className="roll-etikett">
        {r.module} <span className="tyst">(äldre)</span>
      </span>
    );
  }
  return (
    <span className="roll-etikett">
      {r.template_id}
      {r.branschpaket.map((p) => (
        <Chip key={p}>+{p}</Chip>
      ))}
    </span>
  );
}

/** Flikarna (poleringspasset): Provisionera först — det vanligaste
 *  jobbet är startläget; Flotta samlar översikt + hälsa. */
type OperatorFlik = "provisionera" | "flotta" | "forval";

const FLIKAR: { id: OperatorFlik; namn: string }[] = [
  { id: "provisionera", namn: "Provisionera" },
  { id: "flotta", namn: "Flotta" },
  { id: "forval", namn: "Autonomiförval" },
];

const tid = (iso: string) =>
  new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });

/** Relativ ålder för hälsovyn — verklig klocka, avrundad grovt. */
function sedan(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "under 1 min";
  if (min < 60) return `${min} min`;
  const tim = Math.round(min / 60);
  if (tim < 48) return `${tim} tim`;
  return `${Math.round(tim / 24)} dygn`;
}

/** Larmtröskel: ett väntande jobb äldre än så här är en varning —
 *  workern ska hinna runt på minuter, inte kvartar. */
const ALDSTA_VARNING_MS = 15 * 60_000;

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
  const [mallar, setMallar] = useState<PolicyMall[]>([]);
  const [halsa, setHalsa] = useState<Halsa | null>(null);
  const [fel, setFel] = useState("");

  // Flikläget: Provisionera är startfliken (det vanligaste jobbet).
  const [flik, setFlik] = useState<OperatorFlik>("provisionera");
  // Kommandopalettens hopp över flikgränser: målsektionen finns i DOM
  // först EFTER flikbytet, så scroll/fokus körs i en effekt efter render.
  const [hopp, setHopp] = useState<string | null>(null);

  // Översikten: filtrering på roll + status, radval → detalj.
  // Dev-agenter (*-dev/e2e-*) är bortfiltrerade som förval.
  const [flotta, setFlotta] = useState<FlottRad[]>([]);
  const [filtMall, setFiltMall] = useState("");
  const [filtStatus, setFiltStatus] = useState("");
  const [visaDev, setVisaDev] = useState(false);
  const [valdAgent, setValdAgent] = useState<string | null>(null);
  const [detalj, setDetalj] = useState<AgentDetalj | null>(null);
  const [katalog, setKatalog] = useState<Agentkatalog | null>(null);

  // Provisioneringsflödet (WP27): klient → funktionsroll → namn → nyckel.
  const [provKlient, setProvKlient] = useState("");
  const [provMall, setProvMall] = useState("");
  const [provNamn, setProvNamn] = useState("");
  // AgentDraft: fri beskrivning → serverns regelbaserade rollförslag.
  const [draftText, setDraftText] = useState("");
  const [draftSvar, setDraftSvar] = useState("");
  const [draftArbetar, setDraftArbetar] = useState(false);
  // Generationsvakt (granskningsfynd): ett sent svar för en gammal
  // beskrivning får aldrig skriva över operatörens val — räknaren bumpas
  // när texten ändras och när provisioneringen kör, så in-flight-svar
  // som hunnit bli irrelevanta släpps tyst.
  const draftGenRef = useRef(0);
  const [provNyckel, setProvNyckel] = useState<{ rubrik: string; nyckel: string } | null>(null);
  const [arbetar, setArbetar] = useState(false);

  // Detaljens flöden: rotation/avslut bekräftas INLINE (aldrig
  // window.confirm — samma tillgängliga mönster som attestkons avvisning).
  const [roteraBekrafta, setRoteraBekrafta] = useState(false);
  const [avslutaBekrafta, setAvslutaBekrafta] = useState(false);
  const [detaljNyckel, setDetaljNyckel] = useState<{
    agentId: string;
    rubrik: string;
    nyckel: string;
  } | null>(null);

  // Cmd+K.
  const [palettOppen, setPalettOppen] = useState(false);
  const [markeratBolag, setMarkeratBolag] = useState<string | null>(null);
  // Markeringen är en landningssignal, inte ett urval — släck den själv
  // så den inte konkurrerar med agentvalet (granskningsfynd WP29).
  useEffect(() => {
    if (!markeratBolag) return;
    const t = setTimeout(() => setMarkeratBolag(null), 6000);
    return () => clearTimeout(t);
  }, [markeratBolag]);

  // Mall-redigering: formulärstate per mall-id ("" = ny mall).
  const [mallFormer, setMallFormer] = useState<
    Record<string, { namn: string; belopp_kr: string; konfidens: string; kanda: boolean; auto: boolean }>
  >({});
  const [mallSparat, setMallSparat] = useState<Record<string, string>>({});

  const oversiktRef = useRef<HTMLElement>(null);
  const halsaRef = useRef<HTMLElement>(null);
  const mallarRef = useRef<HTMLElement>(null);
  const provRef = useRef<HTMLElement>(null);
  const provKlientRef = useRef<HTMLSelectElement>(null);
  const detaljRef = useRef<HTMLDivElement>(null);

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

  const laddaFlotta = useCallback(async () => {
    const f = await hamta<FlottRad[]>("/api/operator/flotta");
    if (f) setFlotta(f);
  }, []);

  const laddaKatalog = useCallback(async () => {
    const k = await hamta<Agentkatalog>("/api/operator/agentmallar");
    if (k) setKatalog(k);
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
        laddaKatalog();
      }
    })();
  }, [laddaBolag, laddaMallar, laddaHalsa, laddaFlotta, laddaKatalog]);

  useEffect(() => {
    setDetalj(null);
    setRoteraBekrafta(false);
    setAvslutaBekrafta(false);
    if (valdAgent) laddaDetalj(valdAgent);
  }, [valdAgent, laddaDetalj]);

  // Cmd+K öppnar paletten — kommandokatalogen kommer ur den delade
  // byggaren (operatörsrollen; konsulten ser aldrig dessa, WP29).
  useKommandoGenvag(useCallback(() => setPalettOppen((o) => !o), []));

  const kommandon = useMemo(
    () =>
      byggKommandon({
        roll: "operator",
        bolag: bolag.map((b) => ({
          tenant_id: b.tenant_id,
          tenant_namn: b.tenant_namn,
          byra: b.byra,
        })),
        agenter: flotta
          .filter((r) => r.status !== "canceled")
          .map((r) => ({
            agent_id: r.agent_id,
            display_name: r.display_name,
            tenant_namn: r.tenant_namn,
          })),
      }),
    [bolag, flotta],
  );

  const korKommando = useCallback((k: Kommando) => {
    const skilj = k.id.indexOf(":");
    const typ = k.id.slice(0, skilj);
    const varde = k.id.slice(skilj + 1);
    if (typ === "vy") {
      setFlik(varde === "mallar" ? "forval" : "flotta");
      if (varde === "halsa" || varde === "oversikt") setHopp(varde);
    } else if (typ === "atgard" && varde === "provisionera") {
      setFlik("provisionera");
      setHopp("prov");
    } else if (typ === "bolag") {
      setFlik("flotta");
      setMarkeratBolag(varde);
      setHopp(`bolag:${varde}`);
    } else if (typ === "agent") {
      setFlik("flotta");
      setValdAgent(varde);
      setHopp("detalj");
    }
  }, []);

  // Hoppet utförs när målfliken har renderats — refs och element finns
  // inte förrän då. Ett hopp per kommando; effekten släcker sig själv.
  useEffect(() => {
    if (!hopp) return;
    if (hopp === "oversikt") oversiktRef.current?.scrollIntoView({ block: "start" });
    else if (hopp === "halsa") halsaRef.current?.scrollIntoView({ block: "start" });
    else if (hopp === "prov") provKlientRef.current?.focus();
    else if (hopp === "detalj") detaljRef.current?.scrollIntoView({ block: "start" });
    else if (hopp.startsWith("bolag:"))
      document
        .getElementById(`bolag-${hopp.slice("bolag:".length)}`)
        ?.scrollIntoView({ block: "center" });
    setHopp(null);
  }, [hopp]);

  async function loggaUt() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function provisionera() {
    // arbetar-vakten även här: Enter i namnfältet går förbi knappens
    // disabled och får inte dubbelprovisionera (granskningsfynd WP29).
    if (arbetar || !provKlient || !provMall || !provNamn.trim()) return;
    setArbetar(true);
    setFel("");
    try {
      const r = await post<{ agent_id: string; nyckel: string }>("/api/agents", {
        tenant_id: provKlient,
        display_name: provNamn.trim(),
        agentmall: provMall,
      });
      // Klartextnyckeln finns bara i detta svar — nyckelkortet visar den
      // EN gång.
      setProvNyckel({ rubrik: `Nyckel för ${provNamn.trim()}`, nyckel: r.nyckel });
      setProvNamn("");
      // Ett draft-svar som landar EFTER provisioneringen får inte fylla
      // formuläret igen och göra Enter-vägen skarp på nytt.
      draftGenRef.current++;
      await Promise.all([laddaBolag(), laddaFlotta()]);
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    } finally {
      setArbetar(false);
    }
  }

  async function foreslaDraft() {
    if (draftArbetar || !draftText.trim()) return;
    const gen = ++draftGenRef.current;
    setDraftArbetar(true);
    setFel("");
    try {
      const r = await post<{ forslag: { mallId: string; namn: string } | null }>(
        "/api/operator/agentdraft",
        { beskrivning: draftText.trim() },
      );
      // Stale svar (texten ändrad, ny förfrågan skickad eller en
      // provisionering emellan) appliceras aldrig.
      if (gen !== draftGenRef.current) return;
      // Förmarkera bara en roll som faktiskt renderas som radiokort —
      // utan laddad katalog vore valet osynligt och ogranskbart.
      const iKatalogen = katalog?.mallar.find((m) => m.id === r.forslag?.mallId);
      if (r.forslag && iKatalogen) {
        setProvMall(r.forslag.mallId);
        // Namnet är ett förslag och skriver aldrig över något operatören
        // redan hunnit skriva i steg 3.
        setProvNamn((namn) => (namn.trim() ? namn : r.forslag!.namn));
        setDraftSvar(`förslag: ${iKatalogen.displayName} — ändra fritt nedan`);
      } else {
        setDraftSvar("ingen roll matchade beskrivningen — välj själv nedan");
      }
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    } finally {
      // Alltid av — stale betyder bara "applicera inte svaret".
      setDraftArbetar(false);
    }
  }

  async function roteraNyckel() {
    if (!detalj) return;
    setArbetar(true);
    setFel("");
    try {
      const r = await post<{ agent_id: string; nyckel: string }>(
        `/api/agents/${detalj.agent.agent_id}/rotera`,
        { tenant_id: detalj.agent.tenant_id },
      );
      // Rotationen skapar en NY agentrad — öppna den och visa nyckeln där.
      setDetaljNyckel({
        agentId: r.agent_id,
        rubrik: `Ny nyckel för ${detalj.agent.display_name} (rotation)`,
        nyckel: r.nyckel,
      });
      setValdAgent(r.agent_id);
      await Promise.all([laddaBolag(), laddaFlotta()]);
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    } finally {
      setArbetar(false);
    }
  }

  async function sattStatus(metod: "DELETE" | "PATCH", status?: "paused" | "active") {
    if (!detalj) return;
    const { agent_id, tenant_id } = detalj.agent;
    setFel("");
    try {
      await post(`/api/agents/${agent_id}`, { tenant_id, status }, metod);
      await Promise.all([laddaBolag(), laddaFlotta(), laddaDetalj(agent_id)]);
      setAvslutaBekrafta(false);
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
      setFel("förval: belopp ≥ 0 kr och konfidens mellan 0 och 1 krävs");
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

  const mallVal = [...new Set(flotta.map((r) => r.template_id ?? UTAN_MALL))].sort();
  const visadFlotta = flotta
    .filter((r) => visaDev || !arDevAgent(r.display_name))
    .filter((r) => !filtMall || (r.template_id ?? UTAN_MALL) === filtMall)
    .filter((r) => !filtStatus || r.status === filtStatus);
  const flottaPerTenant = new Map<string, FlottRad[]>();
  for (const r of visadFlotta) {
    const lista = flottaPerTenant.get(r.tenant_id);
    if (lista) lista.push(r);
    else flottaPerTenant.set(r.tenant_id, [r]);
  }

  // Steg 2:s härledda branschpaket kommer FÄRDIGA från servern —
  // samma aktivaBranschpaket som driften, aldrig en klientkopia av regeln.
  const provBolag = bolag.find((b) => b.tenant_id === provKlient) ?? null;
  const aktivaPaketFor = (mall: { aktiva_per_tenantmall: Record<string, string[]> }): string[] =>
    provBolag ? (mall.aktiva_per_tenantmall[provBolag.mall] ?? []) : [];

  // Hälsans larmtoner: statusgrönt/varning enligt systemet — tonen är
  // en punkt + värdesfärg, texten bär alltid betydelsen.
  const aldstaGammal = Boolean(
    halsa?.aldsta_vantande &&
      Date.now() - new Date(halsa.aldsta_vantande).getTime() > ALDSTA_VARNING_MS,
  );
  const ton = {
    ko: halsa && halsa.ko_djup > 0 && aldstaGammal ? "varning" : "ok",
    aldsta: aldstaGammal ? "varning" : "ok",
    omforsok: halsa && halsa.omforsok_24h > 0 ? "varning" : "ok",
    // Varning både när workern aldrig kört och när kön väntar för länge
    // sedan senaste körningen (granskningsfynd WP29: "har kört en gång,
    // någonsin" är inte hälsa).
    korning:
      halsa && halsa.ko_djup > 0 && (!halsa.senaste_korning || aldstaGammal)
        ? "varning"
        : "ok",
  } as const;

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
          <button
            onClick={() => setPalettOppen(true)}
            aria-label="Öppna kommandopaletten (Cmd+K)"
            title="Kommandopaletten (Cmd+K)"
          >
            ⌘K
          </button>
          <button onClick={loggaUt}>Logga ut</button>
        </div>
      </div>

      <KommandoPalett
        oppen={palettOppen}
        kommandon={kommandon}
        onVal={korKommando}
        onStang={() => setPalettOppen(false)}
      />

      {/* Flikarna (poleringspasset): sektionerna förblir monterade och
          döljs med hidden — filter, formulär och radval överlever
          flikbyten, och kommandopalettens hopp har alltid sina mål. */}
      <nav className="flikar">
        {FLIKAR.map((f) => (
          <button
            key={f.id}
            className="flik"
            data-aktiv={flik === f.id}
            onClick={() => setFlik(f.id)}
          >
            {f.namn}
          </button>
        ))}
      </nav>

      {/* Översikten (WP27) — flottan: byrå → klientbolag → agenter. */}
      <section className="steg" ref={oversiktRef} hidden={flik !== "flotta"}>
        <div className="steg-rubrik">
          <h2 className="steg-titel">Översikt</h2>
          <span className="steg-not">
            alla agenters hälsa på en skärm · antal är drift, innehållet är byråns
          </span>
        </div>

        <div className="filter-rad">
          <select
            value={filtMall}
            onChange={(e) => setFiltMall(e.target.value)}
            aria-label="filtrera på roll"
          >
            <option value="">alla roller</option>
            {mallVal.map((m) => (
              <option key={m} value={m}>
                {m === UTAN_MALL ? "(äldre)" : m}
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
          <span className="check-val">
            <input
              id="visa-dev"
              type="checkbox"
              checked={visaDev}
              onChange={(e) => setVisaDev(e.target.checked)}
            />
            <label htmlFor="visa-dev">visa dev-agenter</label>
          </span>
        </div>

        {bolag.length === 0 ? (
          <TomtLage>
            Inga bolag ännu — provisionera det första när en byrå skrivit på.
          </TomtLage>
        ) : (
          <div className="svep">
            <table className="rader oversikt">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Status</th>
                  <th>Modul</th>
                  <th>Roll</th>
                  <th className="tal">Förslag/vecka</th>
                  <th className="tal">Senast aktiv</th>
                  <th>Fel</th>
                </tr>
              </thead>
              {bolag.map((b) => {
                const agenter = flottaPerTenant.get(b.tenant_id) ?? [];
                return (
                  <tbody
                    key={b.tenant_id}
                    id={`bolag-${b.tenant_id}`}
                    data-markerad={markeratBolag === b.tenant_id}
                  >
                    <tr className="bolagsrad ej-klickbar">
                      <th colSpan={7} scope="colgroup">
                        <span className="tyst">{b.byra}</span> · {b.tenant_namn}{" "}
                        <Chip>{b.mall}</Chip>
                        <span className="tyst bolags-aggregat">
                          {b.agenter_aktiva} aktiva
                          {b.agenter_pausade > 0 && ` (+${b.agenter_pausade} pausade)`}
                          {" · "}
                          {b.forslag_7d} förslag · {b.beslut_7d} beslut senaste 7 d
                        </span>
                      </th>
                    </tr>
                    {agenter.length === 0 ? (
                      <tr className="ej-klickbar">
                        <td colSpan={7} className="tyst">
                          {flotta.some((r) => r.tenant_id === b.tenant_id)
                            ? "inga agenter matchar filtret"
                            : "inga agenter ännu — provisionera nedan"}
                        </td>
                      </tr>
                    ) : (
                      agenter.map((r) => (
                        <tr
                          key={r.agent_id}
                          data-vald={valdAgent === r.agent_id}
                          onClick={() =>
                            setValdAgent(valdAgent === r.agent_id ? null : r.agent_id)
                          }
                        >
                          <td>
                            {/* Det tangentbordsnåbara valet — radens onClick
                                är bara en större pekyta för samma sak. */}
                            <button
                              className="valj-rad"
                              aria-pressed={valdAgent === r.agent_id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setValdAgent(
                                  valdAgent === r.agent_id ? null : r.agent_id,
                                );
                              }}
                            >
                              {r.display_name}
                            </button>
                            {arDevAgent(r.display_name) && <Chip>dev</Chip>}
                          </td>
                          <td>
                            <StatusPunkt status={r.status} />
                          </td>
                          <td>
                            <Chip>{r.module}</Chip>
                          </td>
                          <td>
                            <RollEtikett r={r} />
                          </td>
                          <td className="tal">
                            {r.forslag_7d === 0 ? (
                              <span className="tyst">inga förslag än</span>
                            ) : (
                              <>
                                <Sparkline
                                  varden={r.forslag_dagar}
                                  etikett={`${r.forslag_7d} förslag senaste 7 dygnen`}
                                />{" "}
                                {r.forslag_7d}
                              </>
                            )}
                          </td>
                          <td className="tal">
                            {r.senaste_aktivitet ? (
                              tid(r.senaste_aktivitet)
                            ) : (
                              <span className="tyst">inga förslag än</span>
                            )}
                          </td>
                          <td>
                            {r.varningar.length === 0 ? (
                              <span className="tyst">—</span>
                            ) : (
                              r.varningar.map((v) => (
                                <Chip key={v} varning>
                                  {VARNINGSTEXT[v]}
                                </Chip>
                              ))
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                );
              })}
            </table>
          </div>
        )}

        {/* Renderingsvakt mot stale-response-racen: en detalj som hann
            hämtas för en TIDIGARE vald rad renderas aldrig — knapparna
            kan därmed aldrig agera på fel agent. */}
        <div ref={detaljRef}>
          {valdAgent && detalj && detalj.agent.agent_id === valdAgent && (
            <div className="flotta-detalj">
              <div className="detalj-rubrik">
                <strong>{detalj.agent.display_name}</strong>
                {arDevAgent(detalj.agent.display_name) && <Chip>dev</Chip>}
                <StatusPunkt status={detalj.agent.status} />
                <span className="tyst">
                  {detalj.agent.tenant_namn} · <RollEtikett r={detalj.agent} /> ·
                  provisionerad av {detalj.agent.provisioned_by}
                </span>
              </div>

              {detaljNyckel && detaljNyckel.agentId === valdAgent && (
                <Nyckelkort rubrik={detaljNyckel.rubrik} nyckel={detaljNyckel.nyckel} />
              )}

              {/* Livslinjen: skapad → pausad → återupptagen … ur
                  audit-händelserna — drift, aldrig innehåll. */}
              <ol className="livslinje" aria-label="Agentens livslinje">
                {detalj.livslinje.map((h, i) => (
                  <li key={i}>
                    <span className="liv-handelse">{LIVSTEXT[h.handelse]}</span>{" "}
                    <span className="tyst">{tid(h.tid)}</span>
                  </li>
                ))}
              </ol>

              <p className="policy-rad">
                policy:{" "}
                {detalj.policy
                  ? `bokför själv upp till ${(detalj.policy.max_belopp_ore / 100).toLocaleString(
                      "sv-SE",
                    )} kr · minst ${detalj.policy.min_confidence} i konfidens · ${
                      detalj.policy.kanda_motparter_endast
                        ? "endast kända motparter"
                        : "alla motparter"
                    } · kinds: ${
                      detalj.policy.tillatna_kinds.join(", ") || "inga (allt attesteras)"
                    }`
                  : "ingen autonomipolicy — allt attesteras"}
                {" · scopes: "}
                {detalj.agent.scopes.map((s) => (
                  <Chip key={s}>{s}</Chip>
                ))}
              </p>

              <p className="policy-rad">
                utfall 7 d: auto {pct(detalj.agent.andel_auto)} · korrigerade{" "}
                {pct(detalj.agent.andel_korrigerade)} · tenantens kö:{" "}
                {detalj.tenant_drift.ko_djup} jobb · senaste worker-körning{" "}
                {detalj.tenant_drift.senaste_korning
                  ? tid(detalj.tenant_drift.senaste_korning)
                  : "—"}
              </p>

              <div className="detalj-atgarder">
                {detalj.agent.status === "active" && (
                  <button onClick={() => sattStatus("PATCH", "paused")}>Pausa</button>
                )}
                {detalj.agent.status === "paused" && (
                  <button onClick={() => sattStatus("PATCH", "active")}>Återuppta</button>
                )}
                {detalj.agent.status === "active" &&
                  (roteraBekrafta ? (
                    <span className="bekrafta-rad">
                      <span className="tyst">
                        en ny agent med samma konfiguration skapas — den gamla
                        nyckeln slutar gälla direkt:
                      </span>
                      <button className="primar" onClick={roteraNyckel} disabled={arbetar}>
                        {arbetar ? "Roterar …" : "Rotera"}
                      </button>
                      <button onClick={() => setRoteraBekrafta(false)} disabled={arbetar}>
                        Avbryt
                      </button>
                    </span>
                  ) : (
                    <button onClick={() => setRoteraBekrafta(true)} disabled={arbetar}>
                      Rotera nyckel
                    </button>
                  ))}
                {detalj.agent.status !== "canceled" &&
                  (avslutaBekrafta ? (
                    <span className="bekrafta-rad">
                      <span className="tyst">
                        agenten avslutas och nyckeln slutar gälla — historiken
                        finns kvar:
                      </span>
                      <button className="primar" onClick={() => sattStatus("DELETE")}>
                        Avsluta
                      </button>
                      <button onClick={() => setAvslutaBekrafta(false)}>Avbryt</button>
                    </span>
                  ) : (
                    <button onClick={() => setAvslutaBekrafta(true)}>Avsluta</button>
                  ))}
              </div>

              {detalj.senaste.length === 0 ? (
                <TomtLage>Inga förslag från den här agenten ännu.</TomtLage>
              ) : (
                <div className="svep">
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
        </div>
      </section>

      {/* Provisioneringen som flöde (WP27): tre steg, tangentbordsvänligt. */}
      <section className="steg" ref={provRef} hidden={flik !== "provisionera"}>
        <div className="steg-rubrik">
          <h2 className="steg-titel">Provisionera agent</h2>
          <span className="steg-not">
            klient → funktionsroll → namn · nyckeln visas EN gång
          </span>
        </div>

        {provNyckel && <Nyckelkort rubrik={provNyckel.rubrik} nyckel={provNyckel.nyckel} />}

        <div className="prov-steg">
          <span className="prov-nr">1.</span>
          <label htmlFor="prov-klient">Klient</label>
          <select
            id="prov-klient"
            ref={provKlientRef}
            value={provKlient}
            onChange={(e) => setProvKlient(e.target.value)}
          >
            <option value="">välj klientbolag …</option>
            {bolag.map((b) => (
              <option key={b.tenant_id} value={b.tenant_id}>
                {b.tenant_namn} — {b.byra}
              </option>
            ))}
          </select>
          {provBolag && (
            <span className="tyst">
              bransch ur kundconfig: <Chip>{provBolag.mall}</Chip>
            </span>
          )}
        </div>

        <fieldset className="prov-steg prov-mallar" data-inaktiv={!provKlient} disabled={!provKlient}>
          <legend>
            <span className="prov-nr">2.</span> Funktionsroll{" "}
            <span className="tyst">
              — fyra roller ur den granskade katalogen; branschen härleds ur
              klienten och väljs aldrig här (ADR-0005)
            </span>
          </legend>
          <div className="draft-rad">
            <input
              id="prov-draft"
              type="text"
              value={draftText}
              onChange={(e) => {
                setDraftText(e.target.value);
                setDraftSvar("");
                // Ändrad text gör ett in-flight-svar irrelevant.
                draftGenRef.current++;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  foreslaDraft();
                }
              }}
              placeholder="beskriv fritt: t.ex. bokföring för min byggfirma"
              aria-label="Beskriv agentens uppgift fritt för ett rollförslag"
            />
            <button onClick={foreslaDraft} disabled={draftArbetar || !draftText.trim()}>
              {draftArbetar ? "Föreslår …" : "Föreslå roll"}
            </button>
            {draftSvar && (
              <span className="tyst" role="status">
                {draftSvar}
              </span>
            )}
          </div>
          <div className="mallval" role="radiogroup" aria-label="Funktionsroll">
            {(katalog?.mallar ?? []).map((m) => {
              const aktiva = aktivaPaketFor(m);
              return (
                <label key={m.id} className="mallkort" data-vald={provMall === m.id}>
                  <input
                    type="radio"
                    name="prov-mall"
                    value={m.id}
                    checked={provMall === m.id}
                    onChange={() => {
                      setProvMall(m.id);
                      // Operatörens eget val vinner alltid över ett
                      // draft-svar som fortfarande är i luften.
                      draftGenRef.current++;
                    }}
                  />
                  <span className="mall-titel">{m.displayName}</span>
                  <span className="mall-meta">
                    <span className="badge granskad">
                      <span className="dot" aria-hidden="true" />
                      granskad
                    </span>
                    <Chip tal>v{m.version}</Chip>
                    {aktiva.map((p) => (
                      <Chip key={p}>
                        +{katalog?.paket[p]?.displayName ?? p}{" "}
                        {katalog?.paket[p]?.version ?? ""}
                      </Chip>
                    ))}
                    {provKlient && m.branschpaket.length > 0 && aktiva.length === 0 && (
                      <span className="tyst">inga paket för klientens bransch</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="prov-steg" data-inaktiv={!provKlient || !provMall}>
          <span className="prov-nr">3.</span>
          <label htmlFor="prov-namn">Namn</label>
          <input
            id="prov-namn"
            type="text"
            value={provNamn}
            disabled={!provKlient || !provMall}
            onChange={(e) => setProvNamn(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                provisionera();
              }
            }}
            placeholder="t.ex. kvittoagent-butik-2"
          />
          <button
            className="primar"
            onClick={provisionera}
            disabled={arbetar || !provKlient || !provMall || !provNamn.trim()}
          >
            {arbetar ? "Provisionerar …" : "Provisionera agent"}
          </button>
        </div>
      </section>

      {/* Hälsovyn (WP27): kön och workern — drift, aldrig innehåll.
          Bor i Flotta-fliken tillsammans med översikten. */}
      <section className="steg" ref={halsaRef} hidden={flik !== "flotta"}>
        <div className="steg-rubrik">
          <h2 className="steg-titel">Hälsa</h2>
          <span className="steg-not">kön och workern — drift, aldrig innehåll</span>
        </div>
        {halsa && (
          <>
            <div className="halsa-rad">
              <div className="halsa-kort" data-ton={ton.ko}>
                <div className="varde">{halsa.ko_djup}</div>
                <div className="etikett">
                  <span className="ton-punkt" aria-hidden="true" /> jobb i kön
                </div>
              </div>
              <div className="halsa-kort" data-ton={ton.aldsta}>
                <div className="varde">
                  {halsa.aldsta_vantande ? sedan(halsa.aldsta_vantande) : "—"}
                </div>
                <div className="etikett">
                  <span className="ton-punkt" aria-hidden="true" /> äldsta väntande jobb
                </div>
              </div>
              <div className="halsa-kort" data-ton={ton.omforsok}>
                <div className="varde">{halsa.omforsok_24h}</div>
                <div className="etikett">
                  <span className="ton-punkt" aria-hidden="true" /> omförsök senaste dygnet
                </div>
              </div>
              <div className="halsa-kort" data-ton={ton.korning}>
                <div className="varde">
                  {halsa.senaste_korning ? tid(halsa.senaste_korning) : "—"}
                </div>
                <div className="etikett">
                  <span className="ton-punkt" aria-hidden="true" /> senaste worker-körning
                </div>
              </div>
            </div>
            {halsa.per_modul.length > 0 && (
              <table className="rader">
                <thead>
                  <tr>
                    <th>Modul</th>
                    <th className="tal">Jobb i kön</th>
                    <th className="tal">Omförsök 24 h</th>
                  </tr>
                </thead>
                <tbody>
                  {halsa.per_modul.map((m) => (
                    <tr key={m.module} className="ej-klickbar">
                      <td>
                        <Chip>{m.module}</Chip>
                      </td>
                      <td className="tal">{m.ko_djup}</td>
                      <td className="tal">{m.omforsok_24h}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {/* Intagskanalen (WP24): underlag per vecka och källa —
                aggregat över flottan, aldrig en rad kundinnehåll. */}
            {halsa.intag_per_vecka.length > 0 && (
              <table className="rader">
                <thead>
                  <tr>
                    <th>Vecka</th>
                    <th>Kanal</th>
                    <th className="tal">Underlag</th>
                  </tr>
                </thead>
                <tbody>
                  {halsa.intag_per_vecka.map((rad) => (
                    <tr key={`${rad.vecka}-${rad.kalla}`} className="ej-klickbar">
                      <td className="tal">{rad.vecka}</td>
                      <td>
                        <Chip>{rad.kalla}</Chip>
                      </td>
                      <td className="tal">{rad.antal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>

      {/* Autonomiförval (policy_mallar i DB — UI-språket följer ADR-0005:
          förval hör till funktionsroller + paket, inte fria mallnamn). */}
      <section className="steg" ref={mallarRef} hidden={flik !== "forval"}>
        <div className="steg-rubrik">
          <h2 className="steg-titel">Autonomiförval</h2>
          <span className="steg-not">
            förval per funktionsroll — seedar policyn vid provisionering;
            byrån justerar sedan i sin arbetsyta
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
                  placeholder="Nytt förval, t.ex. Bokföring — försiktig"
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
                {id ? "Spara" : "Skapa förval"}
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
