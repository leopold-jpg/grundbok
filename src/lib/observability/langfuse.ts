import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import type { LangfuseSpanProcessor } from "@langfuse/otel";
import { MASKERAT, maskeraLangfuseAttribut, maskeraMetadataAttribut } from "./mask";

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

const METADATA_PREFIX = [
  "langfuse.observation.metadata.",
  "langfuse.trace.metadata.",
];

/**
 * Skrubbar de kanaler som LangfuseSpanProcessors mask-krok ALDRIG rör
 * (adversariella granskningens fynd 1 och 3):
 *
 * - Spanstatus: SDK:n sätter err.message som status.message vid throw i
 *   startActiveObservation — okontrollerad text (zod-fel, API-fel) som kan
 *   citera payload. Helmaskas; felklassen syns via level/exception.type.
 * - Exception-events: exception.message/stacktrace maskas, exception.type
 *   (felklassen) behålls.
 * - Flattad metadata (langfuse.*.metadata.<nyckel>): allowlist-grind per
 *   nyckel — anropsplatserna kan inte längre läcka via metadata-kanalen.
 */
function skrubbaOmaskadeKanaler(span: ReadableSpan): void {
  try {
    const s = span as {
      status?: { message?: string };
      events?: { name?: string; attributes?: Record<string, unknown> }[];
      attributes: Record<string, unknown>;
    };
    if (s.status?.message) s.status.message = MASKERAT;
    for (const ev of s.events ?? []) {
      if (ev.name === "exception" && ev.attributes) {
        if ("exception.message" in ev.attributes) ev.attributes["exception.message"] = MASKERAT;
        if ("exception.stacktrace" in ev.attributes) ev.attributes["exception.stacktrace"] = MASKERAT;
      }
    }
    for (const [attrNyckel, varde] of Object.entries(s.attributes)) {
      const prefix = METADATA_PREFIX.find((p) => attrNyckel.startsWith(p));
      if (prefix) {
        s.attributes[attrNyckel] = maskeraMetadataAttribut(
          attrNyckel.slice(prefix.length),
          varde,
        ) as (typeof s.attributes)[string];
      }
    }
  } catch {
    // Skrubbningen får aldrig fälla exporten.
  }
}

/**
 * Bygger LangfuseSpanProcessor med BÅDA maskeringslagren: mask-kroken för
 * input/output och skrubbningen av status/exception/metadata-kanalerna.
 * Exporterad så att låstesterna kör exakt samma processor som produktionen
 * (med in-memory-exporter i stället för nätet).
 */
export async function skapaLangfuseProcessor(
  exporter?: SpanExporter,
): Promise<LangfuseSpanProcessor> {
  const { LangfuseSpanProcessor } = await import("@langfuse/otel");
  const processor = new LangfuseSpanProcessor({
    ...(exporter ? { exporter } : {}),
    mask: ({ data }) => maskeraLangfuseAttribut(data),
    // Payloaden är maskerad — det finns aldrig media att ladda upp.
    mediaUploadEnabled: false,
  });
  const inreOnEnd = processor.onEnd.bind(processor);
  processor.onEnd = (span) => {
    skrubbaOmaskadeKanaler(span);
    inreOnEnd(span);
  };
  return processor;
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
    const [processor, { NodeTracerProvider }] = await Promise.all([
      skapaLangfuseProcessor(),
      import("@opentelemetry/sdk-trace-node"),
    ]);
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
