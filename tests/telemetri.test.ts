// WP12 (ADR-0004): agentmall-pekaren på agentraden, agent_id-stämpeln på
// proposals och telemetrivyn agent_telemetry. Telemetri härleds ALLTID ur
// proposals via vyn — aldrig räknarkolumner på agentraden.
process.env.GRUNDBOK_FORCE_FALLBACK = "1";

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Proposal } from "../src/contracts";
import { createDb } from "../src/lib/db/client";
import { withTenant } from "../src/lib/db/tenant";
import { provisionAgent } from "../src/lib/provisioning";
import { proposalsPort } from "../src/lib/proposals-port";
import { handleProposal, decideProposal, type Principal } from "../src/lib/decisions";
import { körJobb } from "../src/workers/run-agent";
import { roteraNyckel } from "../src/ytor/operator";
import { kaffefaktura } from "../src/lib/exempel";
import { exempelProposal } from "./helpers";

const db = await createDb();

type TelemetriRad = {
  agent_id: string;
  tenant_id: string;
  template_id: string | null;
  template_version: string;
  status: string;
  proposals_7d: string;
  auto_7d: string;
  rejected_7d: string;
  corrected_7d: string;
  last_activity: Date | string | null;
};

/** Service-vägens läsning — operatörens hela flotta, ingen RLS. */
async function telemetri(agentId: string): Promise<TelemetriRad> {
  const r = await db.query<TelemetriRad>(
    `SELECT * FROM agent_telemetry WHERE agent_id = $1`,
    [agentId],
  );
  assert.ok(r.rows[0], `agent ${agentId} saknas i agent_telemetry`);
  return r.rows[0];
}

async function post(nyckel: string, proposal: Proposal) {
  return proposalsPort(db, `Bearer ${nyckel}`, proposal);
}

// Restaurangagenten för kund_a — provisioneras EN gång och bär hela
// telemetrisekvensen nedan (testerna i filen är avsiktligt sekventiella,
// samma mönster som bokforing-flode.test.ts).
const resto = await provisionAgent(
  db,
  { tenantId: "kund_a", mall: "bokforing-restaurang", displayName: "Restoagenten" },
  "test:wp12",
);

test("provisionering ur agentmall: raden pekar på mall + major, policyn kopieras", async () => {
  const rad = await db.query<{
    module: string;
    template_id: string | null;
    template_version: string;
  }>(`SELECT module, template_id, template_version FROM agents WHERE id = $1`, [resto.agent_id]);
  assert.equal(rad.rows[0].module, "bokforing");
  assert.equal(rad.rows[0].template_id, "bokforing-restaurang");
  // Major-pekare — aldrig exakt version på agentraden (ADR-0004).
  assert.equal(rad.rows[0].template_version, "1");

  const policy = await db.query<{ max_belopp_ore: string; min_confidence: string }>(
    `SELECT max_belopp_ore, min_confidence FROM autonomy_policies
     WHERE tenant_id = 'kund_a' AND module = 'bokforing'`,
  );
  assert.equal(Number(policy.rows[0].max_belopp_ore), 200_000);
  assert.equal(Number(policy.rows[0].min_confidence), 0.85);
});

test("porten stämplar agent_id ur principalen — aldrig ur payloaden", async () => {
  const proposal = exempelProposal(); // v0.2-avsändare — inga mallfält
  const svar = await post(resto.nyckel, proposal);
  // Okänd motpart → godkännandekön trots generös restaurangpolicy.
  assert.equal(svar.http, 202);

  const rad = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ agent_id: string | null }>(
      `SELECT agent_id FROM proposals WHERE id = $1`,
      [proposal.id],
    ),
  );
  assert.equal(rad.rows[0].agent_id, resto.agent_id);
});

test("internt UI-flöde utan agentrad → agent_id är null", async () => {
  const principal: Principal = {
    typ: "intern",
    tenant_id: "kund_a",
    module: "*",
    scopes: ["proposals:write"],
    namn: "test:intern",
  };
  const proposal = exempelProposal();
  const resultat = await handleProposal(db, principal, proposal);
  assert.notEqual(resultat.status, "avvisad_vid_porten");
  const rad = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ agent_id: string | null }>(
      `SELECT agent_id FROM proposals WHERE id = $1`,
      [proposal.id],
    ),
  );
  assert.equal(rad.rows[0].agent_id, null);
});

test("workern: mallstämpel i payloaden + agent_id på raden via agentens mallpekare", async () => {
  const doc = await withTenant(db, "kund_a", async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO documents (tenant_id, raw) VALUES ('kund_a', $1) RETURNING id`,
      [kaffefaktura("2026-07-08", 6)],
    );
    return r.rows[0].id;
  });
  const utfall = await körJobb(db, {
    job_id: `telemetri-${randomUUID()}`,
    tenant_id: "kund_a",
    agent_id: resto.agent_id,
    module: "bokforing",
    trigger: "test",
    payload_ref: `document:${doc}`,
  });
  assert.equal(utfall.utfall, "klar");
  if (utfall.utfall !== "klar") return;

  const rad = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ agent_id: string | null; payload: Proposal }>(
      `SELECT agent_id, payload FROM proposals WHERE id = $1`,
      [utfall.proposal_id],
    ),
  );
  assert.equal(rad.rows[0].agent_id, resto.agent_id);
  // Agentens major-pekare '1' → registrets exakta 1.0.0 på förslaget.
  assert.equal(rad.rows[0].payload.mall_id, "bokforing-restaurang");
  assert.equal(rad.rows[0].payload.mall_version, "1.0.0");
  assert.equal(rad.rows[0].payload.contract_version, "0.3.0");
});

test("agent_telemetry: pending/auto/rejected/corrected räknas ur proposals", async () => {
  // Utgångsläge: tre förslag bär agentens id (kö-testet, worker-testet
  // och det interna är null). Bygg nu hela kvalitetssekvensen.
  const fore = await telemetri(resto.agent_id);
  const forePropos = Number(fore.proposals_7d);

  // 1) Godkänn ett pending-förslag → verifikation + känd motpart.
  const p1 = exempelProposal();
  await post(resto.nyckel, p1);
  const beslut1 = await decideProposal(db, {
    tenantId: "kund_a",
    proposalId: p1.id,
    outcome: "approved",
    decidedBy: "konsult@byran.se",
  });
  assert.equal(beslut1.outcome, "approved");
  const v1 = beslut1.outcome === "approved" ? beslut1.verifikation! : null;
  assert.ok(v1);

  // 2) Samma motpart är nu känd + hög konfidens → auto_approved.
  const p2 = exempelProposal({ confidence: 0.95 });
  const svar2 = await post(resto.nyckel, p2);
  assert.equal(svar2.http, 201);

  // 3) Ett förslag under konfidenströskeln köas och avvisas av konsulten.
  const p3 = exempelProposal({ confidence: 0.7 });
  await post(resto.nyckel, p3);
  await decideProposal(db, {
    tenantId: "kund_a",
    proposalId: p3.id,
    outcome: "rejected",
    decidedBy: "konsult@byran.se",
    reason: "Fel underlag",
  });

  // 4) p1:s verifikation rättas → p1 räknas som korrigerad.
  const rattelse = exempelProposal({
    kind: "correction",
    summary: "Rättelse: fel kostnadskonto",
    lines: [
      { konto: "4010", benamning: "Inköp material och varor", debet_ore: 0, kredit_ore: 100_000 },
      { konto: "2641", benamning: "Debiterad ingående moms", debet_ore: 0, kredit_ore: 6_000 },
      { konto: "2440", benamning: "Leverantörsskulder", debet_ore: 106_000, kredit_ore: 0 },
    ],
    provenance: {
      model: "claude-opus-4-8",
      prompt_hash: "0".repeat(64),
      module_version: "0.2.0",
      input_refs: [`verification:${v1!.id}`],
      injection_screened: true,
    },
  });
  await post(resto.nyckel, rattelse);
  await decideProposal(db, {
    tenantId: "kund_a",
    proposalId: rattelse.id,
    outcome: "approved",
    decidedBy: "konsult@byran.se",
  });

  const efter = await telemetri(resto.agent_id);
  assert.equal(Number(efter.proposals_7d), forePropos + 4);
  assert.equal(Number(efter.auto_7d), 1);
  assert.equal(Number(efter.rejected_7d), 1);
  assert.equal(Number(efter.corrected_7d), 1);
  assert.ok(efter.last_activity !== null);
  assert.equal(efter.template_id, "bokforing-restaurang");
});

test("agent_telemetry: tenant-scopad läsning som agents (RLS via security_invoker)", async () => {
  const bygg = await provisionAgent(
    db,
    { tenantId: "kund_b", mall: "bokforing-bygg", displayName: "Byggagenten" },
    "test:wp12",
  );

  const somKundA = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ agent_id: string }>(`SELECT agent_id FROM agent_telemetry`),
  );
  assert.ok(somKundA.rows.some((r) => r.agent_id === resto.agent_id));
  assert.ok(!somKundA.rows.some((r) => r.agent_id === bygg.agent_id));

  const somKundB = await withTenant(db, "kund_b", (tx) =>
    tx.query<{ agent_id: string }>(`SELECT agent_id FROM agent_telemetry`),
  );
  assert.ok(somKundB.rows.some((r) => r.agent_id === bygg.agent_id));
  assert.ok(!somKundB.rows.some((r) => r.agent_id === resto.agent_id));
});

test("nyckelrotation bevarar mallpekaren (Bugbot-fällan i roteraNyckel)", async () => {
  const roterad = await roteraNyckel(db, "kund_a", resto.agent_id, "operator:test");
  const rad = await db.query<{ template_id: string | null; template_version: string }>(
    `SELECT template_id, template_version FROM agents WHERE id = $1`,
    [roterad.agent_id],
  );
  assert.equal(rad.rows[0].template_id, "bokforing-restaurang");
  assert.equal(rad.rows[0].template_version, "1");
});
