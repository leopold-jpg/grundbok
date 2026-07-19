import { startActiveObservation } from "@langfuse/tracing";
import { tolkaMedFallback } from "./fallback";
import { ExtraktionSchema, type Extraktion } from "./schema";

export type TolkningsResultat = {
  extraktion: Extraktion;
  motor: "anthropic" | "fallback";
  motor_detalj: string;
};

/** Binärt underlag (WP21): foto/PDF lagras som data-URI i documents.raw.
 *  LLM-vägen tolkar det med vision/dokumentblock; den deterministiska
 *  fallbacken KAN inte läsa binärt och svarar med en tom extraktion som
 *  modulen eskalerar — regex på en base64-sträng vore påhitt. */
const DATA_URI_RE = /^data:(image\/(?:jpeg|png|webp|gif)|application\/pdf);base64,/;

export function arBinartUnderlag(raw: string): boolean {
  return DATA_URI_RE.test(raw);
}

/** Loggvänlig beskrivning — en data-URI får aldrig skickas som
 *  observability-input i sin helhet. */
export function beskrivUnderlagForLogg(raw: string): string {
  if (!arBinartUnderlag(raw)) return raw;
  const mime = raw.slice(5, raw.indexOf(";"));
  return `[binärt underlag ${mime}, ${raw.length} tecken]`;
}

/** Ärligt tomsvar för binärt underlag utan modellväg: netto 0 och
 *  'ovrigt' — modulen känner igen kombinationen (binärt + fallback) och
 *  eskalerar till konsulten i stället för att kontera på gissning. */
function binarTolkning(detalj: string): TolkningsResultat {
  return {
    extraktion: ExtraktionSchema.parse({
      motpart: "Okänd motpart",
      beskrivning: "Fotograferat/uppladdat underlag — kräver modelltolkning",
      datum: new Date().toISOString().slice(0, 10),
      netto_ore: 0,
      moms_ore: null,
      brutto_ore: null,
      momssats_angiven: null,
      kategori: "ovrigt",
      betalsatt: "direkt",
    }),
    motor: "fallback",
    motor_detalj: detalj,
  };
}

/**
 * Tolkning med automatisk fallback: riktig Anthropic-modell när nyckel
 * finns och nätet svarar; annars den deterministiska mocken — samma
 * schema, samma flöde. UI:t visar diskret vilket läge som kör.
 */
export async function tolka(
  text: string,
  /** Rollkontext (WP31): agentmallens systemprompt + aktiva branschpakets
   *  regler. Når endast den riktiga LLM-vägen — fallbacken är
   *  deterministisk och promptokänslig per definition. */
  systemTillagg?: string,
): Promise<TolkningsResultat> {
  // Langfuse-span runt hela tolkningen (LLM eller fallback) — utan
  // registrerad provider (inga nycklar) är detta en ren no-op via OTel:s
  // noop-tracer. Input/output maskeras centralt i span-processorn.
  return startActiveObservation("tolkning", async (span) => {
    const resultat = await tolkaInner(text, systemTillagg);
    span.update({
      input: { underlag: beskrivUnderlagForLogg(text), underlag_langd: text.length },
      output: {
        motor: resultat.motor,
        motor_detalj: resultat.motor_detalj,
        extraktion: resultat.extraktion,
      },
    });
    return resultat;
  });
}

async function tolkaInner(
  text: string,
  systemTillagg?: string,
): Promise<TolkningsResultat> {
  const harNyckel = Boolean(process.env.ANTHROPIC_API_KEY);
  const tvingaFallback = process.env.GRUNDBOK_FORCE_FALLBACK === "1";

  if (arBinartUnderlag(text) && (!harNyckel || tvingaFallback)) {
    return binarTolkning("binärt underlag utan LLM — eskaleras till konsult");
  }

  if (harNyckel && !tvingaFallback) {
    try {
      // Importeras lazy så att fallback-läget fungerar helt utan nät/SDK-init.
      const { tolkaMedAnthropic } = await import("./anthropic");
      const extraktion = await tolkaMedAnthropic(text, systemTillagg);
      return {
        extraktion,
        motor: "anthropic",
        motor_detalj: process.env.GRUNDBOK_MODEL ?? "claude-opus-4-8",
      };
    } catch (err) {
      const skal = err instanceof Error ? err.message : String(err);
      // Binärt underlag har ingen regex-väg — samma ärliga tomsvar som
      // nyckellöst läge, så modulen eskalerar i stället för att gissa.
      if (arBinartUnderlag(text)) {
        return binarTolkning(`API-anropet föll (binärt underlag eskaleras): ${skal.slice(0, 120)}`);
      }
      const fallback = ExtraktionSchema.parse(tolkaMedFallback(text));
      return {
        extraktion: fallback,
        motor: "fallback",
        motor_detalj: `API-anropet föll: ${skal.slice(0, 120)}`,
      };
    }
  }

  const extraktion = ExtraktionSchema.parse(tolkaMedFallback(text));
  return {
    extraktion,
    motor: "fallback",
    motor_detalj: tvingaFallback ? "GRUNDBOK_FORCE_FALLBACK=1" : "ingen ANTHROPIC_API_KEY i miljön",
  };
}
