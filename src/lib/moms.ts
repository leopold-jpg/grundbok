import { loadMomsRules, loadKundConfig } from "./skills";

export type MomsBeslut = {
  typ: "ingaende" | "omvand";
  sats: number;
  lagrum: string;
  kategori: string;
  kategoriLabel: string;
  konton: {
    ingaende?: string;
    omvand_utgaende?: string;
    omvand_ingaende?: string;
  };
  deklarationsrutor?: { underlag: string; utgaende: string; ingaende: string };
};

/**
 * Deterministiskt momsbeslut för ett inköp: kategori + affärshändelsedatum
 * (+ kundens config) → sats, lagrum och konton. Satserna är datumavgränsade
 * i rules.json — samma kvitto konteras olika beroende på när affärshändelsen
 * inträffade (t.ex. livsmedel 12 % t.o.m. 2026-03-31, 6 % fr.o.m. 2026-04-01).
 */
export function bestamMoms(
  kategori: string,
  affarshandelsedatum: string,
  tenantId: string,
  /** Fall 6: dokumentet anger omvänd skattskyldighet för utländskt
   *  tjänsteinköp (reverse charge, EU-VAT-nr) — observationen kommer ur
   *  extraktionen; beslutet (2614/2645-formen) fattas här. */
  opts?: { omvandEu?: boolean },
): MomsBeslut {
  const rules = loadMomsRules();
  const kund = loadKundConfig(tenantId);
  const momsConfig = (kund.skills["se/moms"]?.config ?? {}) as {
    omvand_bygg?: boolean;
  };

  // Omvänd betalningsskyldighet i byggsektorn (ML 16 kap. 13 §):
  // aktiveras av kundens config (byggmallen), inte av LLM:en.
  if (kategori === "byggtjanst" && momsConfig.omvand_bygg) {
    const bygg = rules.omvand_betalningsskyldighet.bygg;
    return {
      typ: "omvand",
      sats: bygg.sats,
      lagrum: bygg.lagrum,
      kategori: "byggtjanst",
      kategoriLabel: "Byggtjänst, omvänd betalningsskyldighet",
      konton: {
        omvand_utgaende: rules.konton.omvand.utgaende_25,
        omvand_ingaende: rules.konton.omvand.ingaende,
      },
      deklarationsrutor: bygg.deklarationsrutor,
    };
  }

  // Omvänd skattskyldighet för tjänsteinköp från utlandet (fall 6,
  // ML 16 kap. 9 §): utgående moms 2614 + BERÄKNAD ingående moms på
  // förvärv från utlandet 2645 (inte 2647 — den gäller omvänd i
  // Sverige). Byggvägen ovan har företräde när båda skulle träffa.
  if (opts?.omvandEu) {
    const eu = rules.omvand_betalningsskyldighet.eu_tjanst;
    return {
      typ: "omvand",
      sats: eu.sats,
      lagrum: eu.lagrum,
      kategori: "eu_tjanst",
      kategoriLabel: "Tjänsteinköp från utlandet, omvänd skattskyldighet",
      konton: {
        omvand_utgaende: rules.konton.omvand.utgaende_25,
        omvand_ingaende: rules.konton.omvand.ingaende_utland,
      },
      deklarationsrutor: eu.deklarationsrutor,
    };
  }

  const key = rules.kategorialias[kategori] ?? kategori;
  const def = rules.kategorier[key];
  if (!def) {
    // SKILL.md: omodellerade kategorier eskaleras, gissas aldrig.
    // (Extraktionsschemat enum-låser kategorierna, så hit når man bara
    // om rules.json och schemat glidit isär — det ska smälla, inte gissas.)
    throw new Error(
      `Kategori "${kategori}" är inte modellerad i se/moms rules.json — eskalera till konsult`,
    );
  }
  const period = def.satser.find(
    (p) =>
      (p.from === null || affarshandelsedatum >= p.from) &&
      (p.to === null || affarshandelsedatum <= p.to),
  );
  if (!period) {
    throw new Error(
      `Ingen momssats definierad för kategori "${kategori}" per ${affarshandelsedatum}`,
    );
  }
  return {
    typ: "ingaende",
    sats: period.sats,
    lagrum: period.lagrum,
    kategori: key,
    kategoriLabel: def.label,
    konton: { ingaende: rules.konton.ingaende },
  };
}
