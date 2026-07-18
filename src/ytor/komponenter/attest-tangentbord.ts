// Attestkons tangentbordsmaskin (WP26). REN statemaskin — ingen React,
// ingen fetch: komponenten matar händelser (tangenter, serverdata) och
// verkställer effekterna (skicka = POST /api/beslut, det enda API:t —
// flödeslogiken rörs inte).
//
// Ångra-mekaniken är UI-nivå, aldrig ledger-nivå: ett beslut STAGAS
// lokalt och skickas först när nästa beslut fattas, ångra-fönstret löper
// ut eller vyn lämnas. U innan dess återställer raden — inget har nått
// servern, så inget behöver "backas" i den append-only-loggen.

export type AttestBeslut = "godkand" | "avvisad";

export type VantandeBeslut = {
  id: string;
  beslut: AttestBeslut;
  motivering?: string;
  /** Radens plats i kön när den stagades — ångra sätter tillbaka den där. */
  plats: number;
};

export type AttestLage = {
  /** Förslags-id i köordning — maskinen navigerar över dessa. */
  rader: string[];
  /** Vald rad (−1 när kön är tom). */
  index: number;
  /** Motiveringsfältet öppet för vald rad (X-flödet). */
  avvisar: boolean;
  /** Stagat beslut i ångra-fönstret — ännu inte skickat. */
  vantande: VantandeBeslut | null;
};

export type AttestHandelse =
  | { typ: "ner" }
  | { typ: "upp" }
  | { typ: "valj"; index: number }
  | { typ: "attestera" }
  | { typ: "avvisa-oppna" }
  | { typ: "avvisa-skicka"; motivering: string }
  | { typ: "avbryt" }
  | { typ: "angra" }
  | { typ: "commit" }
  | { typ: "rader"; rader: string[] };

export type AttestEffekt =
  | { typ: "skicka"; id: string; beslut: AttestBeslut; motivering?: string }
  | { typ: "aterstalld"; id: string };

export type AttestSteg = { lage: AttestLage; effekter: AttestEffekt[] };

const klamp = (i: number, antal: number) =>
  antal === 0 ? -1 : Math.min(Math.max(i, 0), antal - 1);

export function nyttLage(rader: string[] = []): AttestLage {
  return { rader, index: rader.length > 0 ? 0 : -1, avvisar: false, vantande: null };
}

/** Stagar ett beslut för vald rad. Ett redan väntande beslut committas i
 *  samma steg — det finns alltid högst ETT beslut i ångra-fönstret. */
function staga(lage: AttestLage, beslut: AttestBeslut, motivering?: string): AttestSteg {
  if (lage.index < 0) return { lage, effekter: [] };
  const effekter: AttestEffekt[] = [];
  if (lage.vantande) {
    const { id, beslut: b, motivering: m } = lage.vantande;
    effekter.push({ typ: "skicka", id, beslut: b, motivering: m });
  }
  const id = lage.rader[lage.index];
  const rader = lage.rader.filter((r) => r !== id);
  return {
    lage: {
      rader,
      index: klamp(lage.index, rader.length),
      avvisar: false,
      vantande: { id, beslut, motivering, plats: lage.index },
    },
    effekter,
  };
}

export function attestMaskin(lage: AttestLage, handelse: AttestHandelse): AttestSteg {
  switch (handelse.typ) {
    case "ner":
      return {
        lage: { ...lage, avvisar: false, index: klamp(lage.index + 1, lage.rader.length) },
        effekter: [],
      };
    case "upp":
      return {
        lage: { ...lage, avvisar: false, index: klamp(lage.index - 1, lage.rader.length) },
        effekter: [],
      };
    case "valj":
      return {
        lage: { ...lage, avvisar: false, index: klamp(handelse.index, lage.rader.length) },
        effekter: [],
      };
    case "attestera":
      return staga(lage, "godkand");
    case "avvisa-oppna":
      return { lage: lage.index >= 0 ? { ...lage, avvisar: true } : lage, effekter: [] };
    case "avvisa-skicka": {
      const motivering = handelse.motivering.trim();
      // Motivering krävs för avvisning — samma regel som knappflödet.
      if (!motivering || !lage.avvisar) return { lage, effekter: [] };
      return staga(lage, "avvisad", motivering);
    }
    case "avbryt":
      return { lage: { ...lage, avvisar: false }, effekter: [] };
    case "angra": {
      if (!lage.vantande) return { lage, effekter: [] };
      const { id, plats } = lage.vantande;
      const rader = [...lage.rader];
      const p = Math.min(plats, rader.length);
      rader.splice(p, 0, id);
      return {
        lage: { rader, index: p, avvisar: false, vantande: null },
        effekter: [{ typ: "aterstalld", id }],
      };
    }
    case "commit": {
      if (!lage.vantande) return { lage, effekter: [] };
      const { id, beslut, motivering } = lage.vantande;
      return {
        lage: { ...lage, vantande: null },
        effekter: [{ typ: "skicka", id, beslut, motivering }],
      };
    }
    case "rader": {
      // Färsk serverdata. Ett ännu inte committat beslut ligger kvar som
      // pending hos servern — filtrera bort det så raden inte återuppstår
      // bredvid sitt eget ångra-fönster.
      const rader = handelse.rader.filter((id) => id !== lage.vantande?.id);
      const nuvarande = lage.index >= 0 ? lage.rader[lage.index] : undefined;
      const behallen = nuvarande ? rader.indexOf(nuvarande) : -1;
      return {
        lage: {
          ...lage,
          rader,
          index: behallen >= 0 ? behallen : klamp(lage.index, rader.length),
        },
        effekter: [],
      };
    }
  }
}
