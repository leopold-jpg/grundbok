// Maskeringslås för förhörschattens Langfuse-trace (WP43, kickoffens
// krav: "egen trace-typ forhor, maskering enligt allowlisten"). Samma
// harness som observability.test.ts: den RIKTIGA LangfuseSpanProcessor:n
// med riktig mask-krok mot en in-memory-exporter — det som står i
// exporterns spans är exakt det som skulle ha skickats till Langfuse.
// Egen fil (egen process): registrerar en global OTel-provider.

process.env.GRUNDBOK_FORCE_FALLBACK = "1";
delete process.env.LANGFUSE_PUBLIC_KEY;
delete process.env.LANGFUSE_SECRET_KEY;
delete process.env.LANGFUSE_BASE_URL;

import { test } from "node:test";
import assert from "node:assert/strict";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { skapaLangfuseProcessor } from "../src/lib/observability/langfuse";
import { createDb } from "../src/lib/db/client";
import { withTenant } from "../src/lib/db/tenant";
import { skapaAgentNyckel } from "../src/lib/agent-auth";
import { körJobb } from "../src/workers/run-agent";
import type { AgentJobb } from "../src/lib/queue";
import { forhorFraga } from "../src/modules/forhor";
import { FALL_2_ATA_AVVIKELSE } from "./golden-underlag";

const db = await createDb();

test("förhörets trace läcker aldrig motpart, belopp, fråga eller svar", async () => {
  const exporter = new InMemorySpanExporter();
  const processor = await skapaLangfuseProcessor(exporter);
  new NodeTracerProvider({ spanProcessors: [processor] }).register();

  // Riktigt golden-underlag genom hela pipelinen — förslaget bär motpart,
  // belopp och orderreferens som ALDRIG får nå telemetrin.
  const doc = await withTenant(db, "kund_b", async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO documents (tenant_id, raw) VALUES ('kund_b', $1) RETURNING id`,
      [FALL_2_ATA_AVVIKELSE],
    );
    return r.rows[0].id;
  });
  const { id: agentId } = await skapaAgentNyckel(db, {
    tenantId: "kund_b",
    module: "bokforing",
    scopes: ["proposals:write"],
    namn: "forhor-obs-agent",
    template: { id: "bokforing", major: "1" },
  });
  const jobb: AgentJobb = {
    job_id: "forhor-obs-1",
    tenant_id: "kund_b",
    module: "bokforing",
    trigger: "golden",
    agent_id: agentId,
    payload_ref: `document:${doc}`,
  };
  const utfall = await körJobb(db, jobb);
  assert.ok(utfall.utfall === "klar");

  const fraga = "Vad säger ÄTA-vaksamheten om det här förslaget?";
  const svar = await forhorFraga(db, {
    tenantId: "kund_b",
    proposalId: utfall.proposal_id,
    fraga,
    stalldAv: "konsult-test",
  });
  assert.ok(svar);
  assert.equal(svar!.motor, "fallback");
  await processor.forceFlush();

  const spans = exporter.getFinishedSpans();
  const payload = JSON.stringify(
    spans.map((s) => ({ name: s.name, attributes: s.attributes, status: s.status, events: s.events })),
  );

  // Trace-strukturen: rot + guardrail + retriever + beslutsport (minst).
  const namn = spans.map((s) => s.name);
  for (const kravd of ["forhor-fraga", "injection-screening", "underlag-retrieval", "beslutsport"]) {
    assert.ok(namn.includes(kravd), `spannet ${kravd} saknas (fanns: ${namn.join(", ")})`);
  }

  // Identifierare SKA synas: tenant + modulens agent-identitet.
  assert.ok(payload.includes("kund_b"));
  assert.ok(payload.includes("modul:forhor"));

  // Innehåll får ALDRIG synas: motpart, orderreferens, belopp,
  // underlagstext, frågan och svaret.
  for (const forbjudet of [
    "Underentreprenad",
    "ORD-2026-77",
    "80 000",
    ":8000000",
    "Markarbeten",
    "ÄTA-vaksamheten om det här",
    "888-8888",
  ]) {
    assert.ok(!payload.includes(forbjudet), `"${forbjudet}" läckte till trace-payloaden`);
  }
  // Svarets text (citatet ur paketregeln) får inte heller läcka.
  assert.ok(!payload.includes(svar!.svar.slice(0, 40)), "svarstexten läckte till trace-payloaden");
});
