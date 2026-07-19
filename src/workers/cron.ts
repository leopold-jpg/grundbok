import { getDb } from "@/lib/db/client";
import { initLangfuse, flushLangfuse } from "@/lib/observability/langfuse";
import { PgliteKo, type KoMeddelande } from "@/lib/queue";
import { körJobb } from "./run-agent";

// Cron-stub (WP9): pollar kön och kör jobb med per-tenant concurrency-tak.
// Körbar lokalt: `npm run worker` (loop) eller `npm run worker -- --once`
// (en pollrunda — används i tester/CI). Formen är Vercel cron/Edge
// Function-kompatibel: en körning = en pollrunda; deploy tas i separat
// session (icke-mål).
//
// OBS lokal PGlite: en process åt gången mot .data — kör inte workern
// samtidigt som dev-servern. I produktion (riktig Postgres/Supabase)
// finns ingen sådan begränsning.

const MAX_LASNING = 10;
const VT_SEKUNDER = 60;
const MAX_FORSOK = 3;

/** Kör en batch med per-tenant-tak: max N samtidiga jobb per tenant
 *  (N = agents.max_concurrency via jobbets meddelande, default 2). */
export async function körBatch(
  meddelanden: KoMeddelande[],
  körare: (m: KoMeddelande) => Promise<void>,
  takPerTenant: (m: KoMeddelande) => number,
): Promise<void> {
  const köPerTenant = new Map<string, KoMeddelande[]>();
  for (const m of meddelanden) {
    const lista = köPerTenant.get(m.message.tenant_id) ?? [];
    lista.push(m);
    köPerTenant.set(m.message.tenant_id, lista);
  }
  // Varje tenant får en egen pool med sitt tak; tenants körs parallellt
  // med varandra — bullrig granne sinkar bara sig själv (ADR-0003).
  await Promise.all(
    [...köPerTenant.values()].map(async (lista) => {
      const tak = Math.max(1, takPerTenant(lista[0]));
      let index = 0;
      const arbetare = Array.from({ length: Math.min(tak, lista.length) }, async () => {
        while (index < lista.length) {
          const m = lista[index++];
          await körare(m);
        }
      });
      await Promise.all(arbetare);
    }),
  );
}

async function enPollrunda(): Promise<number> {
  const db = await getDb();
  const ko = new PgliteKo(db);
  const meddelanden = await ko.read({ qty: MAX_LASNING, vtSeconds: VT_SEKUNDER });
  if (meddelanden.length === 0) return 0;

  const tak = new Map<string, number>();
  for (const m of meddelanden) {
    if (!tak.has(m.message.agent_id)) {
      const r = await db.query<{ max_concurrency: number }>(
        `SELECT max_concurrency FROM agents WHERE id = $1`,
        [m.message.agent_id],
      );
      tak.set(m.message.agent_id, Number(r.rows[0]?.max_concurrency ?? 2));
    }
  }

  await körBatch(
    meddelanden,
    async (m) => {
      try {
        const utfall = await körJobb(db, m.message);
        if (utfall.utfall === "fel" && m.read_ct < MAX_FORSOK) {
          // Lämna i kön — vt släpper jobbet för nytt försök.
          console.error(`jobb ${m.message.job_id}: ${utfall.detalj} (försök ${m.read_ct}/${MAX_FORSOK})`);
          return;
        }
        if (utfall.utfall === "fel") {
          console.error(`jobb ${m.message.job_id}: ger upp efter ${m.read_ct} försök — ${utfall.detalj}`);
        } else {
          console.log(`jobb ${m.message.job_id}: ${utfall.utfall}${"status" in utfall ? ` (${utfall.status})` : ""}`);
        }
        await ko.archive(m.msg_id);
      } catch (err) {
        console.error(`jobb ${m.message.job_id}: oväntat fel`, err);
        if (m.read_ct >= MAX_FORSOK) await ko.archive(m.msg_id);
      }
    },
    (m) => tak.get(m.message.agent_id) ?? 2,
  );
  return meddelanden.length;
}

async function main() {
  const once = process.argv.includes("--once");
  console.log(`grundbok-worker: pollar agent_jobs (${once ? "en runda" : "loop, Ctrl-C avslutar"})`);
  // Langfuse-tracing för jobbtraces (no-op utan nycklar). Init + flush bor
  // i main(): tester importerar körBatch utan sidoeffekter.
  await initLangfuse();
  let kör = true;
  process.on("SIGINT", () => { kör = false; });

  do {
    const antal = await enPollrunda();
    // Flush per pollrunda — scriptform utan flush tappar spans vid exit.
    await flushLangfuse();
    if (!once && antal === 0) await new Promise((r) => setTimeout(r, 2000));
  } while (kör && !once);

  process.exit(0);
}

// Körs bara som script (npm run worker) — importeras av tester utan sidoeffekt.
if (process.argv[1]?.endsWith("cron.ts")) {
  main();
}
