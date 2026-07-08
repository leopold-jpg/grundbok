import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { withTenant } from "../src/lib/db/tenant";
import { PgliteKo, type AgentJobb, type KoMeddelande } from "../src/lib/queue";
import { uuidv5 } from "../src/lib/uuid5";
import { körJobb } from "../src/workers/run-agent";
import { körBatch } from "../src/workers/cron";
import { skapaAgentNyckel, sattAgentStatus } from "../src/lib/agent-auth";
import { kaffefaktura } from "../src/lib/exempel";

// WP9: kö-semantik + generiska workern. Tolkningen tvingas till den
// deterministiska fallbacken — inga nätanrop i testsviten.
process.env.GRUNDBOK_FORCE_FALLBACK = "1";

const db = await createDb();
const ko = new PgliteKo(db);

async function skapaDokument(tenantId: string, text: string): Promise<string> {
  return withTenant(db, tenantId, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO documents (tenant_id, raw) VALUES ($1, $2) RETURNING id`,
      [tenantId, text],
    );
    return r.rows[0].id;
  });
}

async function skapaAgent(tenantId: string): Promise<string> {
  const { id } = await skapaAgentNyckel(db, {
    tenantId,
    module: "bokforing",
    scopes: ["proposals:write"],
    namn: `worker-agent-${tenantId}`,
  });
  return id;
}

function jobb(overrides: Partial<AgentJobb> & Pick<AgentJobb, "agent_id" | "payload_ref">): AgentJobb {
  return {
    job_id: `jobb-${Math.random().toString(36).slice(2)}`,
    tenant_id: "kund_a",
    module: "bokforing",
    trigger: "test",
    ...overrides,
  };
}

test("kö-semantik: send → read (osynligt under vt) → archive", async () => {
  const agentId = await skapaAgent("kund_a");
  const doc = await skapaDokument("kund_a", "x");
  const msgId = await ko.send(jobb({ agent_id: agentId, payload_ref: `document:${doc}` }));
  assert.ok(msgId >= 1);

  const first = await ko.read({ qty: 10, vtSeconds: 60 });
  assert.equal(first.length, 1);
  assert.equal(first[0].read_ct, 1);

  // Utcheckat meddelande är osynligt tills vt löper ut.
  const second = await ko.read({ qty: 10, vtSeconds: 60 });
  assert.equal(second.length, 0);

  await ko.archive(first[0].msg_id);
  assert.equal(await ko.depth(), 0);
});

test("uuid v5 är deterministisk och giltig", () => {
  const a = uuidv5("jobb-123");
  const b = uuidv5("jobb-123");
  const c = uuidv5("jobb-124");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("workern kör ett jobb: tolkning → kontering → porten → pending", async () => {
  const agentId = await skapaAgent("kund_a");
  const doc = await skapaDokument("kund_a", kaffefaktura("2026-07-08", 6));
  const j = jobb({ agent_id: agentId, payload_ref: `document:${doc}` });

  const utfall = await körJobb(db, j);
  assert.equal(utfall.utfall, "klar");
  if (utfall.utfall !== "klar") return;
  assert.equal(utfall.status, "pending"); // default-policyn auto-godkänner inget
  assert.equal(utfall.proposal_id, uuidv5(j.job_id));

  // Provenance bär worker-runtime — skiljer körningen i beslutsloggen.
  const payload = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ payload: { provenance: { agent_runtime?: string } } }>(
      `SELECT payload FROM proposals WHERE id = $1`,
      [utfall.proposal_id],
    ),
  );
  assert.equal(payload.rows[0].payload.provenance.agent_runtime, "worker-lokal@0.2");
});

test("idempotens: samma jobb kört två gånger → exakt en proposal", async () => {
  const agentId = await skapaAgent("kund_a");
  const doc = await skapaDokument("kund_a", kaffefaktura("2026-07-08", 6));
  const j = jobb({ agent_id: agentId, payload_ref: `document:${doc}` });

  const forsta = await körJobb(db, j);
  assert.equal(forsta.utfall, "klar");
  const andra = await körJobb(db, j);
  assert.equal(andra.utfall, "duplicate");

  const antal = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM proposals WHERE id = $1`, [
      uuidv5(j.job_id),
    ]),
  );
  assert.equal(Number(antal.rows[0].n), 1);
});

test("pausad agent → skip (ack, ingen proposal)", async () => {
  const agentId = await skapaAgent("kund_a");
  await sattAgentStatus(db, "kund_a", agentId, "paused");
  const doc = await skapaDokument("kund_a", kaffefaktura("2026-07-08", 6));
  const j = jobb({ agent_id: agentId, payload_ref: `document:${doc}` });

  const utfall = await körJobb(db, j);
  assert.equal(utfall.utfall, "skip");
  const antal = await withTenant(db, "kund_a", (tx) =>
    tx.query(`SELECT 1 FROM proposals WHERE id = $1`, [uuidv5(j.job_id)]),
  );
  assert.equal(antal.rows.length, 0);
});

test("jobb för tenant A kan inte referera tenant B:s agent", async () => {
  const agentB = await skapaAgent("kund_b");
  const doc = await skapaDokument("kund_a", kaffefaktura("2026-07-08", 6));
  const j = jobb({ agent_id: agentB, payload_ref: `document:${doc}`, tenant_id: "kund_a" });

  const utfall = await körJobb(db, j);
  assert.equal(utfall.utfall, "fel");
  if (utfall.utfall === "fel") assert.match(utfall.detalj, /tenant-mismatch/);
});

test("körBatch respekterar per-tenant concurrency-tak", async () => {
  let samtidiga = 0;
  let maxSamtidiga = 0;
  const meddelanden: KoMeddelande[] = Array.from({ length: 6 }, (_, i) => ({
    msg_id: i + 1,
    read_ct: 1,
    message: jobb({ agent_id: "x", payload_ref: "document:x", job_id: `j${i}` }),
  }));

  await körBatch(
    meddelanden,
    async () => {
      samtidiga++;
      maxSamtidiga = Math.max(maxSamtidiga, samtidiga);
      await new Promise((r) => setTimeout(r, 10));
      samtidiga--;
    },
    () => 2,
  );
  assert.equal(maxSamtidiga, 2);
});
