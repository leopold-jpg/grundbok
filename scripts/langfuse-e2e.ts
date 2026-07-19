// E2E-körning av Langfuse-instrumenteringen (uppdragets steg 3:
// "run and self-audit the traces"). Kör de två LLM-flödena med samma
// trace-rötter som API-routerna och skriver trace-id:n till stdout så
// att de kan hämtas och granskas via langfuse-cli:
//
//   npx tsx scripts/langfuse-e2e.ts
//
// Läser .env.local (LANGFUSE_* + ev. ANTHROPIC_API_KEY). Utan
// LANGFUSE-nycklar är körningen en no-op — precis som i produktion.

process.loadEnvFile(".env.local");

import {
  getActiveTraceId,
  propagateAttributes,
  startActiveObservation,
} from "@langfuse/tracing";
import { initLangfuse, flushLangfuse, langfuseAktiv } from "../src/lib/observability/langfuse";

await initLangfuse();
console.log(`langfuse aktiv: ${langfuseAktiv()}`);

const { createDb } = await import("../src/lib/db/client");
const { tolka } = await import("../src/lib/extract");
const { svaraPaFraga } = await import("../src/modules/radgivning");
const { kaffefaktura } = await import("../src/lib/exempel");

// 1) Intagsflödet — samma rot som POST /api/byra/intag/tolka.
const intagTraceId = await propagateAttributes(
  {
    traceName: "intag-tolkning",
    userId: "kund_a",
    metadata: { tenant_id: "kund_a", agent_id: "konsult:manuell-intag" },
    tags: ["intag", "e2e"],
  },
  () =>
    startActiveObservation("intag-tolkning", async (span) => {
      const faktura = kaffefaktura("2026-07-08", 6);
      const r = await tolka(faktura);
      span.update({
        input: { underlag_langd: faktura.length },
        output: { motor: r.motor, antal_fynd: 0 },
      });
      console.log(`tolka: motor=${r.motor} motpart=${r.extraktion.motpart}`);
      return getActiveTraceId();
    }),
);
console.log(`trace intag-tolkning: ${intagTraceId}`);

// 2) Rådgivningsflödet — trace-roten bor i svaraPaFraga själv.
const db = await createDb();
const radgivning = await svaraPaFraga(
  db,
  "kund_a",
  "Vilken momssats gäller för livsmedel efter 1 april 2026?",
);
console.log(`radgivning: motor=${radgivning.motor} status=${radgivning.status} konfidens=${radgivning.konfidens}`);

await flushLangfuse();
console.log("flush klar");
process.exit(0);
