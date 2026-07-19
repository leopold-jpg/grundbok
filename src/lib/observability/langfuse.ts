import { maskeraLangfuseAttribut } from "./mask";

// Langfuse-init (observability). Tre hårda regler:
//
// 1. Saknas LANGFUSE-nycklar i miljön registreras ingen provider —
//    @langfuse/tracing-anropen i koden blir no-ops via OTel:s noop-tracer.
//    Ingen varning, inget fel: observability får aldrig fälla ett jobb.
// 2. Init är idempotent och får aldrig kasta (try/catch runt allt).
// 3. Maskeringen (mask.ts) kopplas HÄR, i span-processorn — den enda
//    exportvägen. Anropsplatser kan inte kringgå den.
//
// Tillståndet bor på globalThis: Next kan bundla instrumentation-hooken
// och route-moduler som separata modulinstanser, och flushLangfuse måste
// nå exakt den processor som registrerades.

type LangfuseTillstand = {
  initierad: boolean;
  processor: { forceFlush(): Promise<void> } | null;
};

const G = globalThis as typeof globalThis & {
  __grundbokLangfuse?: LangfuseTillstand;
};

function tillstand(): LangfuseTillstand {
  G.__grundbokLangfuse ??= { initierad: false, processor: null };
  return G.__grundbokLangfuse;
}

/** Är Langfuse-export konfigurerad i miljön? */
export function langfuseAktiv(): boolean {
  return Boolean(
    process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY,
  );
}

/**
 * Registrerar OTel-providern med LangfuseSpanProcessor. Anropas från
 * Next-instrumentationen (src/instrumentation.ts) och worker-scriptet.
 * Importen av SDK-paketen sker lazy så att kodvägar utan nycklar aldrig
 * ens laddar dem.
 */
export async function initLangfuse(): Promise<void> {
  const t = tillstand();
  if (t.initierad) return;
  t.initierad = true;
  if (!langfuseAktiv()) return;

  try {
    const [{ LangfuseSpanProcessor }, { NodeTracerProvider }] = await Promise.all([
      import("@langfuse/otel"),
      import("@opentelemetry/sdk-trace-node"),
    ]);
    const processor = new LangfuseSpanProcessor({
      mask: ({ data }) => maskeraLangfuseAttribut(data),
      // Payloaden är maskerad — det finns aldrig media att ladda upp.
      mediaUploadEnabled: false,
    });
    new NodeTracerProvider({ spanProcessors: [processor] }).register();
    t.processor = processor;
  } catch (err) {
    t.processor = null;
    console.error("langfuse: init misslyckades — kör vidare utan tracing", err);
  }
}

/** Tömmer spanbufferten (serverless: anropas i after() / efter pollrunda).
 *  No-op utan init; sväljer fel — flush får aldrig fälla ett svar. */
export async function flushLangfuse(): Promise<void> {
  try {
    await tillstand().processor?.forceFlush();
  } catch {
    // Medvetet tyst: exportfel får aldrig påverka applikationsflödet.
  }
}
