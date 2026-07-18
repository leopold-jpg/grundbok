import { tolkaMedFallback } from "./fallback";
import { ExtraktionSchema, type Extraktion } from "./schema";

export type TolkningsResultat = {
  extraktion: Extraktion;
  motor: "anthropic" | "fallback";
  motor_detalj: string;
};

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
  const harNyckel = Boolean(process.env.ANTHROPIC_API_KEY);
  const tvingaFallback = process.env.GRUNDBOK_FORCE_FALLBACK === "1";

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
