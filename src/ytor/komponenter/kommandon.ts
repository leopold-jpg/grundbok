// Cmd+K-palettens kommandokatalog (WP26/WP27). REN modul — byggaren är
// den enda källan till vilka kommandon en roll ser: konsulten får ALDRIG
// operatörskommandon (provisionering, bolag, flotta) och tvärtom, även
// om anroparen skulle skicka med fel data (WP29-regeln testas här).

export type KommandoGrupp =
  | "navigera"
  | "klient"
  | "motpart"
  | "bolag"
  | "agent"
  | "atgard";

export type Kommando = {
  /** Maskinläsbart: "<typ>:<värde>" — anroparen switchar på prefixet. */
  id: string;
  rubrik: string;
  detalj?: string;
  grupp: KommandoGrupp;
  /** Sökbara extraord utöver rubrik/detalj. */
  nyckelord?: string;
};

export type KonsultKontext = {
  roll: "konsult";
  klienter: { id: string; namn: string }[];
  /** Unika motparter ur attestkön — sök hoppar till förslaget. */
  motparter: string[];
};

export type OperatorKontext = {
  roll: "operator";
  bolag: { tenant_id: string; tenant_namn: string; byra: string }[];
  agenter: { agent_id: string; display_name: string; tenant_namn: string }[];
};

export function byggKommandon(ctx: KonsultKontext | OperatorKontext): Kommando[] {
  if (ctx.roll === "konsult") {
    return [
      { id: "flik:attest", rubrik: "Gå till attestkön", grupp: "navigera", nyckelord: "att attestera kö" },
      { id: "flik:intag", rubrik: "Gå till underlag in", grupp: "navigera", nyckelord: "intag tolka kvitto" },
      { id: "flik:chatt", rubrik: "Gå till chatten", grupp: "navigera", nyckelord: "fråga saldo moms" },
      { id: "flik:logg", rubrik: "Gå till beslutsloggen", grupp: "navigera", nyckelord: "logg historik" },
      { id: "flik:klient", rubrik: "Gå till klientvyn", grupp: "navigera", nyckelord: "policy verifikationer agenter" },
      { id: "klient:alla", rubrik: "Visa alla klienter", grupp: "klient" },
      ...ctx.klienter.map((k) => ({
        id: `klient:${k.id}`,
        rubrik: `Visa ${k.namn}`,
        grupp: "klient" as const,
        nyckelord: "klient byt",
      })),
      ...ctx.motparter.map((m) => ({
        id: `motpart:${m}`,
        rubrik: `Sök motpart ${m}`,
        detalj: "hoppar till förslaget i attestkön",
        grupp: "motpart" as const,
      })),
    ];
  }

  // Operatören: drift — aldrig förslags-innehåll i kommandona heller
  // (agent-/bolagsnamn är driftmetadata, motparter finns inte här).
  return [
    { id: "atgard:provisionera", rubrik: "Provisionera agent", detalj: "klient → roll → namn → nyckel", grupp: "atgard" },
    { id: "vy:oversikt", rubrik: "Gå till flottan", grupp: "navigera", nyckelord: "översikten agenter start" },
    { id: "vy:halsa", rubrik: "Gå till hälsan", grupp: "navigera", nyckelord: "kö worker drift flottan" },
    { id: "vy:mallar", rubrik: "Gå till autonomiförvalen", grupp: "navigera", nyckelord: "policymallar autonomi förval" },
    ...ctx.bolag.map((b) => ({
      id: `bolag:${b.tenant_id}`,
      rubrik: `Visa ${b.tenant_namn}`,
      detalj: b.byra,
      grupp: "bolag" as const,
    })),
    ...ctx.agenter.map((a) => ({
      id: `agent:${a.agent_id}`,
      rubrik: `Öppna ${a.display_name}`,
      detalj: a.tenant_namn,
      grupp: "agent" as const,
    })),
  ];
}

/** Alla söktermens ord måste träffa rubrik, detalj eller nyckelord. */
export function filtreraKommandon(kommandon: Kommando[], term: string): Kommando[] {
  const ord = term.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (ord.length === 0) return kommandon;
  return kommandon.filter((k) => {
    const text = `${k.rubrik} ${k.detalj ?? ""} ${k.nyckelord ?? ""}`.toLowerCase();
    return ord.every((o) => text.includes(o));
  });
}
