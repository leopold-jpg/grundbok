import { bestamMoms, type MomsBeslut } from "./moms";
import { loadKonteringRules, loadKundConfig, skillVersions } from "./skills";
import type { Extraktion } from "./extract/schema";

export type KonteringsRad = {
  konto: string;
  kontonamn: string;
  debet_ore: number;
  kredit_ore: number;
};

export type Flagga = {
  id: string;
  niva: "info" | "varning";
  text: string;
  /** Maskinläsbar flaggdata (WP32): t.ex. restbelopp för missing_receipt
   *  (kompletteringskön läser härifrån) eller median för anomaly_amount. */
  data?: Record<string, number | string>;
};

export type Forslag = {
  dokument: Extraktion;
  affarshandelsedatum: string;
  rader: KonteringsRad[];
  moms: MomsBeslut & { moms_ore: number };
  netto_ore: number;
  brutto_ore: number;
  flaggor: Flagga[];
  skill_versions: Record<string, string>;
};

/**
 * Deterministisk kontering: tolkat dokument + kundconfig → konteringsrader.
 * LLM:en väljer aldrig konton fritt — kategorin mappas mot rules.json och
 * momsen beräknas av regelmotorn (TaxHacker-läxan: enum-via-prompt räcker
 * inte för BAS-kontering; se ATTRIBUTION.md). Heltalsaritmetik i ören.
 */
export function kontera(
  extraktion: Extraktion,
  tenantId: string,
  affarshandelsedatum?: string,
  /** Granskningens kontoöverstyrning (WP32): förskott konteras 1480
   *  Förskott till leverantör i stället för kostnadskonto — beslutet
   *  fattas deterministiskt i granskning.ts, aldrig av LLM:en. */
  kostnadskontoOverride?: { konto: string; namn: string },
): Forslag {
  const rules = loadKonteringRules();
  const kund = loadKundConfig(tenantId);
  const datum = affarshandelsedatum ?? extraktion.datum;
  const flaggor: Flagga[] = [];

  const moms = bestamMoms(extraktion.kategori, datum, tenantId);
  const netto = extraktion.netto_ore;
  const moms_ore = Math.round((netto * moms.sats) / 100);

  // Flagga om kvittots angivna moms avviker från regelverkets sats för
  // kategorin + datumet. Regelverket styr förslaget (lagen bestämmer satsen,
  // inte kvittot) — men avvikelsen ersätts aldrig tyst: konsulten avgör.
  // Undantag (WP32-fynd): vid omvänd betalningsskyldighet SKA säljaren
  // fakturera utan moms — dokumentets 0 kr är korrekt, aldrig en avvikelse.
  if (
    moms.typ !== "omvand" &&
    extraktion.moms_ore !== null &&
    Math.abs(extraktion.moms_ore - moms_ore) > 1
  ) {
    flaggor.push({
      id: "momssats_avviker",
      niva: "varning",
      text:
        `Dokumentet anger moms ${fmtKr(extraktion.moms_ore)} men regelverket ger ` +
        `${moms.sats} % = ${fmtKr(moms_ore)} för ${moms.kategoriLabel.toLowerCase()} ` +
        `per ${datum} (${moms.lagrum}). Förslaget följer regelverket — granska mot underlaget.`,
    });
  }

  // Kontoval: kundens overrides går före skillens standard.
  const overrides = (kund.skills["se/bas-kontering"]?.config ?? {}) as {
    konto_overrides?: Record<string, string>;
    beloppsgrans_flagga_sek?: number;
  };
  const kostnadsKey =
    moms.typ === "omvand" ? "byggtjanst_omvand" : extraktion.kategori;
  const kostnadDef =
    rules.kostnadskonton[kostnadsKey] ?? rules.kostnadskonton["ovrigt"];
  // Prioritet: granskningens override (förskott→1480) > kundens
  // konto-overrides > skillens standard.
  const kostnad = kostnadskontoOverride ?? kostnadDef;
  const kostnadskonto =
    kostnadskontoOverride?.konto ??
    overrides.konto_overrides?.[kostnadsKey] ??
    kostnadDef.konto;

  const motkontoDef =
    extraktion.betalsatt === "direkt"
      ? rules.motkonton["direktbetalning"]
      : rules.motkonton["leverantorsfaktura"];

  const rader: KonteringsRad[] = [];
  let brutto: number;

  if (moms.typ === "omvand") {
    // Omvänd betalningsskyldighet (ML 16 kap. 13 §): säljaren fakturerar
    // utan moms; köparen redovisar ut- OCH ingående moms. Nettoeffekt noll
    // vid full avdragsrätt. Rutor 24/30/48.
    brutto = netto;
    rader.push(
      rad(kostnadskonto, kostnad.namn, netto, 0),
      rad(motkontoDef.konto, motkontoDef.namn, 0, netto),
      rad(moms.konton.omvand_utgaende!, "Utgående moms, omvänd betalningsskyldighet, 25 %", 0, moms_ore),
      rad(moms.konton.omvand_ingaende!, "Ingående moms, omvänd betalningsskyldighet", moms_ore, 0),
    );
  } else {
    brutto = netto + moms_ore;
    rader.push(
      rad(kostnadskonto, kostnad.namn, netto, 0),
      rad(moms.konton.ingaende!, "Debiterad ingående moms", moms_ore, 0),
      rad(motkontoDef.konto, motkontoDef.namn, 0, brutto),
    );
  }

  // Invarianter (se/bas-kontering rules.json) — blockerande, inte flaggor.
  const debet = rader.reduce((s, r) => s + r.debet_ore, 0);
  const kredit = rader.reduce((s, r) => s + r.kredit_ore, 0);
  if (debet !== kredit) {
    throw new Error(
      `Invariant bruten: debet (${debet}) ≠ kredit (${kredit}) — förslaget avvisas`,
    );
  }
  if (moms.typ === "ingaende" && netto + moms_ore !== brutto) {
    throw new Error("Invariant bruten: netto + moms ≠ brutto");
  }

  // Verifikationens innehåll (BFL 5 kap. 7 §): utan dessa kan förslaget
  // inte godkännas.
  if (!extraktion.motpart || !extraktion.beskrivning || !datum || netto <= 0) {
    throw new Error(
      "Förslaget saknar obligatoriskt verifikationsinnehåll (BFL 5 kap. 7 §): motpart, beskrivning, datum och belopp krävs",
    );
  }

  const grans = overrides.beloppsgrans_flagga_sek ?? kund.approval.beloppsgrans_flagga_sek;
  if (grans !== undefined && brutto > grans * 100) {
    flaggor.push({
      id: "belopp_over_grans",
      niva: "info",
      text: `Brutto ${fmtKr(brutto)} överstiger kundens granskningsgräns ${grans.toLocaleString("sv-SE")} kr.`,
    });
  }

  return {
    dokument: extraktion,
    affarshandelsedatum: datum,
    rader,
    moms: { ...moms, moms_ore },
    netto_ore: netto,
    brutto_ore: brutto,
    flaggor,
    skill_versions: skillVersions(),
  };
}

function rad(
  konto: string,
  kontonamn: string,
  debet_ore: number,
  kredit_ore: number,
): KonteringsRad {
  return { konto, kontonamn, debet_ore, kredit_ore };
}

export function fmtKr(ore: number): string {
  return (
    (ore / 100).toLocaleString("sv-SE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " kr"
  );
}
